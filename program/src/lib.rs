#![allow(unexpected_cfgs)]
use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::Sysvar,
};

entrypoint!(process_instruction);
mod token;
const MAX_HOLDERS: usize = 16;
const MAX_ACTIONS: usize = 16;
/// Latest record date accepted after an obligation becomes due; bounds operator typos.
const RECORD_GRACE: i64 = 30 * 86_400;
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct Holder {
    pub wallet: [u8; 32],
    pub units: u64,
}
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct Entitlement {
    pub holder: u8,
    pub units: u64,
    pub retire_units: u64,
    pub amount: u64,
    pub settled: bool,
}
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct Action {
    pub kind: u8,
    pub period: u8,
    pub bps: u16,
    pub record_at: i64,
    pub snapshot_slot: u64,
    pub status: u8,
    pub rows: Vec<Entitlement>,
}
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct Instrument {
    pub initialized: bool,
    pub authority: [u8; 32],
    pub face: u64,
    pub coupon_bps: u16,
    pub frequency: u8,
    pub periods: u8,
    pub issued_at: i64,
    pub maturity: i64,
    pub supply: u64,
    pub retired: u64,
    pub coupon_mask: u64,
    pub holders: Vec<Holder>,
    pub actions: Vec<Action>,
    pub tokens: token::TokenState,
}
#[derive(BorshSerialize, BorshDeserialize)]
pub enum Instruction {
    Initialize {
        face: u64,
        coupon_bps: u16,
        frequency: u8,
        periods: u8,
        maturity: i64,
        holders: Vec<Holder>,
    },
    Schedule {
        kind: u8,
        period: u8,
        bps: u16,
        record_at: i64,
    },
    Snapshot,
    Initiate,
    Confirm {
        holder: u8,
    },
    Transfer {
        from: u8,
        to: u8,
        units: u64,
    },
    AttachTokens,
    /// Removes the latest action before any entitlement of it is paid.
    Cancel,
    /// Returns the remaining escrow to the issuer after the instrument is closed.
    Withdraw,
}
fn ensure(ok: bool, message: &str) -> ProgramResult {
    if !ok {
        msg!("{}", message);
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}
fn math() -> ProgramError {
    ProgramError::ArithmeticOverflow
}
pub fn coupon(units: u64, face: u64, bps: u16, frequency: u8) -> Result<u64, ProgramError> {
    ensure(frequency > 0, "Frequency must be positive")?;
    u64::try_from(
        (units as u128)
            .checked_mul(face as u128)
            .ok_or_else(math)?
            .checked_mul(bps as u128)
            .ok_or_else(math)?
            / (10_000 * frequency as u128),
    )
    .map_err(|_| math())
}
fn active(s: &Instrument) -> bool {
    s.actions.last().map(|a| a.status != 4).unwrap_or(false)
}
fn validate_holders(holders: &[Holder]) -> Result<u64, ProgramError> {
    ensure(
        !holders.is_empty() && holders.len() <= MAX_HOLDERS,
        "Invalid registry size",
    )?;
    let mut supply = 0u64;
    for (i, h) in holders.iter().enumerate() {
        ensure(h.units > 0 && h.wallet != [0; 32], "Invalid holder")?;
        ensure(
            !holders[..i].iter().any(|x| x.wallet == h.wallet),
            "Duplicate holder",
        )?;
        supply = supply.checked_add(h.units).ok_or_else(math)?;
    }
    Ok(supply)
}
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let state = next_account_info(iter)?;
    let signer = next_account_info(iter)?;
    ensure(
        state.owner == program_id && state.is_writable,
        "Wrong state owner or not writable",
    )?;
    if !signer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let ix = Instruction::try_from_slice(data).map_err(|_| ProgramError::InvalidInstructionData)?;
    let clock = Clock::get()?;
    let bytes = state.try_borrow_data()?;
    let mut slice = &bytes[..];
    let mut s =
        Instrument::deserialize(&mut slice).map_err(|_| ProgramError::InvalidAccountData)?;
    drop(bytes);
    match ix {
        Instruction::Initialize {
            face,
            coupon_bps,
            frequency,
            periods,
            maturity,
            holders,
        } => {
            ensure(!s.initialized, "Already initialized")?;
            // Initialization must be atomic with creation; the state key signs initialization.
            ensure(state.is_signer, "State account must sign initialization")?;
            ensure(
                face > 0
                    && coupon_bps <= 10_000
                    && frequency > 0
                    && periods > 0
                    && periods <= 12
                    && maturity > clock.unix_timestamp
                    && maturity.saturating_sub(clock.unix_timestamp) <= 3_156_000_000,
                "Invalid terms",
            )?;
            let supply = validate_holders(&holders)?;
            supply.checked_mul(face).ok_or_else(math)?;
            s = Instrument {
                initialized: true,
                authority: signer.key.to_bytes(),
                face,
                coupon_bps,
                frequency,
                periods,
                issued_at: clock.unix_timestamp,
                maturity,
                supply,
                retired: 0,
                coupon_mask: 0,
                holders,
                actions: vec![],
                tokens: token::TokenState::default(),
            };
            msg!("Instrument issued: {} units", supply);
        }
        Instruction::Transfer { from, to, units } => {
            ensure(s.initialized, "Uninitialized")?;
            ensure(
                (from as usize) < s.holders.len()
                    && (to as usize) < s.holders.len()
                    && from != to
                    && units > 0,
                "Invalid transfer",
            )?;
            ensure(
                s.holders[from as usize].wallet == signer.key.to_bytes(),
                "Holder signature required",
            )?;
            ensure(clock.unix_timestamp < s.maturity, "Instrument matured")?;
            if let Some(a) = s.actions.last() {
                ensure(
                    a.status == 4 || clock.unix_timestamp < a.record_at,
                    "Record-date transfer lock",
                )?;
            }
            if s.tokens.enabled {
                token::transfer(program_id, accounts, &s, from as usize, to as usize, units)?;
            }
            s.holders[from as usize].units = s.holders[from as usize]
                .units
                .checked_sub(units)
                .ok_or(ProgramError::InsufficientFunds)?;
            s.holders[to as usize].units = s.holders[to as usize]
                .units
                .checked_add(units)
                .ok_or_else(math)?;
        }
        other => {
            let own_claim = if let Instruction::Confirm { holder } = &other {
                s.tokens.enabled
                    && s.holders
                        .get(*holder as usize)
                        .map(|h| h.wallet == signer.key.to_bytes())
                        .unwrap_or(false)
            } else {
                false
            };
            ensure(
                s.initialized && (s.authority == signer.key.to_bytes() || own_claim),
                "Issuer authority required",
            )?;
            match other {
                Instruction::AttachTokens => token::attach(program_id, accounts, &mut s)?,
                Instruction::Cancel => {
                    ensure(s.authority == signer.key.to_bytes(), "Issuer authority required")?;
                    let a = s.actions.last().ok_or(ProgramError::InvalidArgument)?;
                    ensure(
                        a.status < 3 && a.rows.iter().all(|r| !r.settled),
                        "Only an unpaid action can be cancelled",
                    )?;
                    s.actions.pop();
                    msg!("Latest action cancelled");
                }
                Instruction::Withdraw => {
                    ensure(s.authority == signer.key.to_bytes(), "Issuer authority required")?;
                    ensure(
                        s.tokens.enabled && s.supply == 0 && !active(&s),
                        "Escrow is released only after full redemption",
                    )?;
                    token::withdraw(program_id, accounts, &s.tokens, signer.key)?;
                }
                Instruction::Schedule {
                    kind,
                    period,
                    bps,
                    record_at,
                } => {
                    ensure(
                        !active(&s) && s.actions.len() < MAX_ACTIONS && s.supply > 0,
                        "Active action or no capacity/supply",
                    )?;
                    ensure(
                        kind <= 2 && record_at >= clock.unix_timestamp,
                        "Invalid kind or historical record date",
                    )?;
                    let latest = |due: i64| due.max(clock.unix_timestamp) + RECORD_GRACE;
                    if kind == 0 {
                        ensure(
                            period > 0
                                && period <= s.periods
                                && s.coupon_mask & (1u64 << period) == 0,
                            "Coupon period invalid or already used",
                        )?;
                        let due = s.issued_at
                            + (s.maturity - s.issued_at) * (period as i64) / (s.periods as i64);
                        ensure(record_at >= due, "Coupon period not due")?;
                        ensure(record_at <= latest(due), "Record date too far after due date")?;
                        ensure(bps == 0, "Coupon uses instrument rate")?;
                    } else if kind == 1 {
                        ensure(
                            record_at >= s.maturity && bps == 10_000,
                            "Redemption before maturity",
                        )?;
                        ensure(
                            record_at <= latest(s.maturity),
                            "Record date too far after maturity",
                        )?;
                        let all = (1u64 << (s.periods as u64 + 1)) - 2;
                        ensure(
                            s.coupon_mask == all,
                            "Settle all coupon periods before final redemption",
                        )?;
                    } else {
                        ensure(
                            bps > 0 && bps < 10_000 && record_at < s.maturity,
                            "Invalid partial redemption",
                        )?;
                        ensure(
                            s.holders
                                .iter()
                                .any(|h| (h.units as u128) * (bps as u128) >= 10_000),
                            "Partial redemption retires no whole bond",
                        )?;
                        let remaining_coupons =
                            s.periods as usize - s.coupon_mask.count_ones() as usize;
                        ensure(
                            s.actions.len() + remaining_coupons + 1 < MAX_ACTIONS,
                            "Reserve capacity for coupons and final redemption",
                        )?;
                    }
                    s.actions.push(Action {
                        kind,
                        period,
                        bps,
                        record_at,
                        snapshot_slot: 0,
                        status: 0,
                        rows: vec![],
                    });
                    msg!("Action scheduled");
                }
                Instruction::Snapshot => {
                    let a = s.actions.last_mut().ok_or(ProgramError::InvalidArgument)?;
                    ensure(
                        a.status == 0 && clock.unix_timestamp >= a.record_at,
                        "Snapshot not due or already taken",
                    )?;
                    for (i, h) in s.holders.iter().enumerate().filter(|(_, h)| h.units > 0) {
                        let retire_units = if a.kind == 0 {
                            0
                        } else if a.kind == 1 {
                            h.units
                        } else {
                            ((h.units as u128) * (a.bps as u128) / 10_000) as u64
                        };
                        let amount = if a.kind == 0 {
                            coupon(h.units, s.face, s.coupon_bps, s.frequency)?
                        } else {
                            retire_units.checked_mul(s.face).ok_or_else(math)?
                        };
                        a.rows.push(Entitlement {
                            holder: i as u8,
                            units: h.units,
                            retire_units,
                            amount,
                            settled: false,
                        });
                    }
                    a.snapshot_slot = clock.slot;
                    a.status = 1;
                    msg!("Immutable record-date snapshot at slot {}", clock.slot);
                }
                Instruction::Initiate => {
                    let a = s.actions.last_mut().ok_or(ProgramError::InvalidArgument)?;
                    ensure(a.status == 1, "Snapshot required; cannot initiate twice")?;
                    a.status = 2;
                    msg!("Settlement obligations initiated on-chain");
                }
                Instruction::Confirm { holder } => {
                    let a = s.actions.last_mut().ok_or(ProgramError::InvalidArgument)?;
                    ensure(a.status == 2 || a.status == 3, "Settlement not initiated")?;
                    let row = a
                        .rows
                        .iter_mut()
                        .find(|r| r.holder == holder)
                        .ok_or(ProgramError::InvalidArgument)?;
                    ensure(!row.settled, "Already settled")?;
                    if s.tokens.enabled {
                        token::settle(
                            program_id,
                            accounts,
                            &s.tokens,
                            &s.holders[holder as usize],
                            row.amount,
                            row.retire_units,
                        )?;
                    }
                    s.holders[holder as usize].units = s.holders[holder as usize]
                        .units
                        .checked_sub(row.retire_units)
                        .ok_or_else(math)?;
                    s.supply = s.supply.checked_sub(row.retire_units).ok_or_else(math)?;
                    s.retired = s.retired.checked_add(row.retire_units).ok_or_else(math)?;
                    row.settled = true;
                    a.status = 3;
                    let retired_units = row.retire_units;
                    if a.rows.iter().all(|r| r.settled) {
                        a.status = 4;
                        if a.kind == 0 {
                            s.coupon_mask |= 1u64 << a.period;
                        }
                    }
                    msg!(
                        "Settlement attested for holder {}; retired {} units",
                        holder,
                        retired_units
                    );
                }
                _ => return Err(ProgramError::InvalidInstructionData),
            }
        }
    }
    let encoded = borsh::to_vec(&s).map_err(|_| ProgramError::InvalidAccountData)?;
    let mut dst = state.try_borrow_mut_data()?;
    ensure(encoded.len() <= dst.len(), "Account full")?;
    dst.fill(0);
    dst[..encoded.len()].copy_from_slice(&encoded);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_example() {
        assert_eq!(coupon(10, 1_000_000_000, 1000, 2).unwrap(), 500_000_000);
    }
    #[test]
    fn round_down_once() {
        assert_eq!(coupon(3, 1, 5000, 2).unwrap(), 0);
    }
    #[test]
    fn overflow_rejected() {
        assert!(coupon(u64::MAX, u64::MAX, 10_000, 1).is_err());
    }
    #[test]
    fn zero_frequency_rejected() {
        assert!(coupon(1, 100, 100, 0).is_err());
    }
    #[test]
    fn duplicate_registry_rejected() {
        let h = Holder {
            wallet: [1; 32],
            units: 1,
        };
        assert!(validate_holders(&[h.clone(), h]).is_err());
    }
}
