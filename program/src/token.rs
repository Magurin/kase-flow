//! Restricted Token-2022 bonds and SPL test-cash settlement.
//! Every bond account is frozen between program instructions. The PDA is the
//! mint/freeze authority and permanent delegate; owners cannot bypass snapshots.
use super::*;
use solana_program::{program::invoke_signed, program_option::COption, program_pack::Pack};
use spl_token_2022::{
    extension::{
        permanent_delegate::PermanentDelegate, BaseStateWithExtensions, ExtensionType,
        StateWithExtensions,
    },
    state::{Account as BondAccount, AccountState, Mint as BondMint},
};

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, Default)]
pub struct TokenState {
    pub enabled: bool,
    pub bond_mint: [u8; 32],
    pub cash_mint: [u8; 32],
    pub vault: [u8; 32],
}
fn authority(program: &Pubkey, state: &AccountInfo, pda: &AccountInfo) -> Result<u8, ProgramError> {
    let (key, bump) = Pubkey::find_program_address(&[b"vault", state.key.as_ref()], program);
    ensure(key == *pda.key, "Wrong vault authority")?;
    Ok(bump)
}
fn bond_account(
    a: &AccountInfo,
    mint: &Pubkey,
    wallet: &[u8; 32],
    units: u64,
    frozen: bool,
) -> ProgramResult {
    ensure(a.owner == &spl_token_2022::id(), "Wrong bond token program")?;
    let data = a.try_borrow_data()?;
    let t = StateWithExtensions::<BondAccount>::unpack(&data)?;
    ensure(
        t.base.mint == *mint && t.base.owner.to_bytes() == *wallet && t.base.amount == units,
        "Bond account does not match registry",
    )?;
    ensure(
        t.base.state
            == if frozen {
                AccountState::Frozen
            } else {
                AccountState::Initialized
            },
        "Wrong bond freeze state",
    )
}
fn cash_account(a: &AccountInfo, mint: &Pubkey, owner: &Pubkey) -> ProgramResult {
    ensure(a.owner == &spl_token::id(), "Wrong cash token program")?;
    let t = spl_token::state::Account::unpack(&a.try_borrow_data()?)?;
    ensure(
        t.mint == *mint
            && t.owner == *owner
            && t.state == spl_token::state::AccountState::Initialized,
        "Wrong settlement account",
    )?;
    ensure(t.is_native == COption::None, "Native cash unsupported")
}
fn cpi(
    ix: solana_program::instruction::Instruction,
    infos: &[AccountInfo],
    state: &Pubkey,
    bump: u8,
) -> ProgramResult {
    invoke_signed(&ix, infos, &[&[b"vault", state.as_ref(), &[bump]]])
}
fn freeze<'a>(
    account: &AccountInfo<'a>,
    mint: &AccountInfo<'a>,
    pda: &AccountInfo<'a>,
    program: &AccountInfo<'a>,
    state: &Pubkey,
    bump: u8,
    frozen: bool,
) -> ProgramResult {
    let ix = if frozen {
        spl_token_2022::instruction::freeze_account(
            program.key,
            account.key,
            mint.key,
            pda.key,
            &[],
        )?
    } else {
        spl_token_2022::instruction::thaw_account(program.key, account.key, mint.key, pda.key, &[])?
    };
    cpi(
        ix,
        &[account.clone(), mint.clone(), pda.clone(), program.clone()],
        state,
        bump,
    )
}
pub fn attach(program: &Pubkey, accounts: &[AccountInfo], s: &mut Instrument) -> ProgramResult {
    ensure(
        !s.tokens.enabled && s.actions.is_empty() && s.retired == 0,
        "Tokens already attached or lifecycle started",
    )?;
    ensure(
        accounts.len() == 8 + s.holders.len(),
        "Missing issuance accounts",
    )?;
    let (state, pda, mint, cash, vault, token, spl) = (
        &accounts[0],
        &accounts[2],
        &accounts[3],
        &accounts[4],
        &accounts[5],
        &accounts[6],
        &accounts[7],
    );
    let bump = authority(program, state, pda)?;
    ensure(
        *token.key == spl_token_2022::id() && *spl.key == spl_token::id(),
        "Wrong token programs",
    )?;
    ensure(
        mint.owner == token.key && cash.owner == spl.key,
        "Wrong mint owners",
    )?;
    {
        let data = mint.try_borrow_data()?;
        let m = StateWithExtensions::<BondMint>::unpack(&data)?;
        let delegate = m.get_extension::<PermanentDelegate>()?;
        ensure(
            m.base.decimals == 0
                && m.base.supply == 0
                && m.base.mint_authority == COption::Some(*pda.key)
                && m.base.freeze_authority == COption::Some(*pda.key)
                && Option::<Pubkey>::from(delegate.delegate) == Some(*pda.key),
            "Invalid bond mint authorities",
        )?;
        // Display metadata is allowed; any extension that can move or hook tokens is not.
        ensure(
            m.get_extension_types()?.iter().all(|t| {
                matches!(
                    t,
                    ExtensionType::PermanentDelegate
                        | ExtensionType::MetadataPointer
                        | ExtensionType::TokenMetadata
                )
            }),
            "Unexpected bond mint extensions",
        )?;
    }
    let cash_mint = spl_token::state::Mint::unpack(&cash.try_borrow_data()?)?;
    ensure(cash_mint.decimals == 6, "Cash decimals must be six")?;
    cash_account(vault, cash.key, pda.key)?;
    let v = spl_token::state::Account::unpack(&vault.try_borrow_data()?)?;
    ensure(
        v.delegate == COption::None && v.close_authority == COption::None,
        "Vault must have no external delegate",
    )?;
    for (i, holder) in s.holders.iter().enumerate() {
        let account = &accounts[8 + i];
        bond_account(account, mint.key, &holder.wallet, 0, false)?;
        cpi(
            spl_token_2022::instruction::mint_to_checked(
                token.key,
                mint.key,
                account.key,
                pda.key,
                &[],
                holder.units,
                0,
            )?,
            &[mint.clone(), account.clone(), pda.clone(), token.clone()],
            state.key,
            bump,
        )?;
        freeze(account, mint, pda, token, state.key, bump, true)?;
    }
    s.tokens = TokenState {
        enabled: true,
        bond_mint: mint.key.to_bytes(),
        cash_mint: cash.key.to_bytes(),
        vault: vault.key.to_bytes(),
    };
    msg!("Token-2022 bonds issued and frozen; SPL cash escrow attached");
    Ok(())
}
pub fn settle(
    program: &Pubkey,
    accounts: &[AccountInfo],
    tokens: &TokenState,
    holder: &Holder,
    amount: u64,
    retire: u64,
) -> ProgramResult {
    ensure(accounts.len() == 10, "Missing settlement accounts")?;
    let (state, pda, mint, cash, vault, token, spl, bond, recipient) = (
        &accounts[0],
        &accounts[2],
        &accounts[3],
        &accounts[4],
        &accounts[5],
        &accounts[6],
        &accounts[7],
        &accounts[8],
        &accounts[9],
    );
    let bump = authority(program, state, pda)?;
    ensure(
        *token.key == spl_token_2022::id() && *spl.key == spl_token::id(),
        "Wrong token programs",
    )?;
    ensure(
        mint.key.to_bytes() == tokens.bond_mint
            && cash.key.to_bytes() == tokens.cash_mint
            && vault.key.to_bytes() == tokens.vault,
        "Wrong settlement mint or vault",
    )?;
    cash_account(vault, cash.key, pda.key)?;
    cash_account(recipient, cash.key, &Pubkey::new_from_array(holder.wallet))?;
    bond_account(bond, mint.key, &holder.wallet, holder.units, true)?;
    // Transfer and burn are in one instruction: any error rolls both back.
    cpi(
        spl_token::instruction::transfer_checked(
            spl.key,
            vault.key,
            cash.key,
            recipient.key,
            pda.key,
            &[],
            amount,
            6,
        )?,
        &[
            vault.clone(),
            cash.clone(),
            recipient.clone(),
            pda.clone(),
            spl.clone(),
        ],
        state.key,
        bump,
    )?;
    if retire > 0 {
        freeze(bond, mint, pda, token, state.key, bump, false)?;
        cpi(
            spl_token_2022::instruction::burn_checked(
                token.key,
                bond.key,
                mint.key,
                pda.key,
                &[],
                retire,
                0,
            )?,
            &[bond.clone(), mint.clone(), pda.clone(), token.clone()],
            state.key,
            bump,
        )?;
        freeze(bond, mint, pda, token, state.key, bump, true)?;
    }
    msg!(
        "SPL cash paid: {}; Token-2022 bonds burned: {}",
        amount,
        retire
    );
    Ok(())
}
pub fn transfer(
    program: &Pubkey,
    accounts: &[AccountInfo],
    s: &Instrument,
    from: usize,
    to: usize,
    units: u64,
) -> ProgramResult {
    ensure(accounts.len() == 7, "Missing transfer accounts")?;
    let (state, pda, mint, token, source, dest) = (
        &accounts[0],
        &accounts[2],
        &accounts[3],
        &accounts[4],
        &accounts[5],
        &accounts[6],
    );
    let bump = authority(program, state, pda)?;
    ensure(
        *token.key == spl_token_2022::id() && mint.key.to_bytes() == s.tokens.bond_mint,
        "Wrong bond mint or program",
    )?;
    bond_account(
        source,
        mint.key,
        &s.holders[from].wallet,
        s.holders[from].units,
        true,
    )?;
    bond_account(
        dest,
        mint.key,
        &s.holders[to].wallet,
        s.holders[to].units,
        true,
    )?;
    freeze(source, mint, pda, token, state.key, bump, false)?;
    freeze(dest, mint, pda, token, state.key, bump, false)?;
    cpi(
        spl_token_2022::instruction::transfer_checked(
            token.key,
            source.key,
            mint.key,
            dest.key,
            pda.key,
            &[],
            units,
            0,
        )?,
        &[
            source.clone(),
            mint.clone(),
            dest.clone(),
            pda.clone(),
            token.clone(),
        ],
        state.key,
        bump,
    )?;
    freeze(source, mint, pda, token, state.key, bump, true)?;
    freeze(dest, mint, pda, token, state.key, bump, true)
}
pub fn withdraw(
    program: &Pubkey,
    accounts: &[AccountInfo],
    tokens: &TokenState,
    issuer: &Pubkey,
) -> ProgramResult {
    ensure(accounts.len() == 7, "Missing withdrawal accounts")?;
    let (state, pda, cash, vault, spl, destination) = (
        &accounts[0],
        &accounts[2],
        &accounts[3],
        &accounts[4],
        &accounts[5],
        &accounts[6],
    );
    let bump = authority(program, state, pda)?;
    ensure(*spl.key == spl_token::id(), "Wrong cash token program")?;
    ensure(
        cash.key.to_bytes() == tokens.cash_mint && vault.key.to_bytes() == tokens.vault,
        "Wrong escrow mint or vault",
    )?;
    cash_account(vault, cash.key, pda.key)?;
    cash_account(destination, cash.key, issuer)?;
    let amount = spl_token::state::Account::unpack(&vault.try_borrow_data()?)?.amount;
    ensure(amount > 0, "Escrow is empty")?;
    cpi(
        spl_token::instruction::transfer_checked(
            spl.key,
            vault.key,
            cash.key,
            destination.key,
            pda.key,
            &[],
            amount,
            6,
        )?,
        &[
            vault.clone(),
            cash.clone(),
            destination.clone(),
            pda.clone(),
            spl.clone(),
        ],
        state.key,
        bump,
    )?;
    msg!("Escrow residual returned to issuer: {}", amount);
    Ok(())
}
