//! Fast lifecycle tests: the compiled SBF program runs in LiteSVM with the real
//! SPL Token and Token-2022 programs. Build first: `cargo build-sbf`.
#![allow(deprecated)]
use borsh::BorshDeserialize;
use kase_flow::{Holder, Instruction as Ix, Instrument};
use litesvm::LiteSVM;
use solana_address::Address;
use solana_clock::Clock;
use solana_keypair::Keypair;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    program_pack::Pack,
    pubkey::Pubkey,
    system_instruction,
};
use solana_signer::Signer;
use solana_transaction::Transaction;
use spl_token_2022::{
    extension::{ExtensionType, StateWithExtensions},
    instruction::AuthorityType,
    state::{Account as BondAccount, Mint as BondMint},
};

const FACE: u64 = 1_000_000_000;
const T0: i64 = 1_000_000;
const RESIDUAL: u64 = 1_000_000;
const ATA: Pubkey = solana_program::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

fn addr(p: &Pubkey) -> Address {
    Address::from(p.to_bytes())
}
fn pk(a: &Address) -> Pubkey {
    Pubkey::new_from_array(a.to_bytes())
}
fn key(k: &Keypair) -> Pubkey {
    pk(&k.pubkey())
}
fn convert(ix: Instruction) -> solana_instruction::Instruction {
    solana_instruction::Instruction {
        program_id: addr(&ix.program_id),
        accounts: ix
            .accounts
            .iter()
            .map(|m| solana_instruction::AccountMeta {
                pubkey: addr(&m.pubkey),
                is_signer: m.is_signer,
                is_writable: m.is_writable,
            })
            .collect(),
        data: ix.data,
    }
}
fn ata(wallet: &Pubkey, mint: &Pubkey, token: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[wallet.as_ref(), token.as_ref(), mint.as_ref()], &ATA).0
}
fn create_ata(payer: &Pubkey, wallet: &Pubkey, mint: &Pubkey, token: &Pubkey) -> Instruction {
    Instruction {
        program_id: ATA,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(ata(wallet, mint, token), false),
            AccountMeta::new_readonly(*wallet, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(solana_program::system_program::id(), false),
            AccountMeta::new_readonly(*token, false),
        ],
        data: vec![1],
    }
}

#[derive(Default, Clone, Copy)]
struct Options {
    metadata: bool,
    forbidden_extension: bool,
}

struct Env {
    svm: LiteSVM,
    program: Pubkey,
    issuer: Keypair,
    state: Keypair,
    holders: Vec<Keypair>,
    pda: Pubkey,
    bond: Pubkey,
    cash: Pubkey,
    vault: Pubkey,
    bonds: Vec<Pubkey>,
    cashes: Vec<Pubkey>,
    attached: Result<(), String>,
}

impl Env {
    fn new(options: Options) -> Self {
        let mut svm = LiteSVM::new();
        let program = Pubkey::new_unique();
        svm.add_program_from_file(addr(&program), "target/deploy/kase_flow.so")
            .expect("run `cargo build-sbf` before `cargo test`");
        let issuer = Keypair::new();
        svm.airdrop(&issuer.pubkey(), 100_000_000_000).unwrap();
        let state = Keypair::new();
        let holders = vec![Keypair::new(), Keypair::new()];
        let pda = Pubkey::find_program_address(&[b"vault", key(&state).as_ref()], &program).0;
        let (bond_kp, cash_kp) = (Keypair::new(), Keypair::new());
        let (bond, cash) = (key(&bond_kp), key(&cash_kp));
        let t22 = spl_token_2022::id();
        let spl = spl_token::id();
        let mut env = Env {
            vault: ata(&pda, &cash, &spl),
            bonds: holders.iter().map(|h| ata(&key(h), &bond, &t22)).collect(),
            cashes: holders.iter().map(|h| ata(&key(h), &cash, &spl)).collect(),
            svm,
            program,
            issuer,
            state,
            holders,
            pda,
            bond,
            cash,
            attached: Ok(()),
        };
        env.at(T0);
        let issuer = key(&env.issuer);

        let rent = env.svm.minimum_balance_for_rent_exemption(16384);
        let init = env.ix(
            &Ix::Initialize {
                face: FACE,
                coupon_bps: 1000,
                frequency: 2,
                periods: 2,
                maturity: T0 + 1000,
                holders: vec![
                    Holder {
                        wallet: key(&env.holders[0]).to_bytes(),
                        units: 10,
                    },
                    Holder {
                        wallet: key(&env.holders[1]).to_bytes(),
                        units: 20,
                    },
                ],
            },
            &issuer,
            vec![],
            true,
        );
        let create =
            system_instruction::create_account(&issuer, &key(&env.state), rent, 16384, &program);
        let state_kp = env.state.insecure_clone();
        env.send(vec![create, init], &[&state_kp]).unwrap();

        let mut extensions = vec![ExtensionType::PermanentDelegate];
        if options.metadata {
            extensions.push(ExtensionType::MetadataPointer);
        }
        if options.forbidden_extension {
            extensions.push(ExtensionType::MintCloseAuthority);
        }
        let len = ExtensionType::try_calculate_account_len::<BondMint>(&extensions).unwrap();
        let lamports = env.svm.minimum_balance_for_rent_exemption(len + 512);
        let mint_authority = if options.metadata { issuer } else { pda };
        let mut ixs = vec![
            system_instruction::create_account(&issuer, &bond, lamports, len as u64, &t22),
            spl_token_2022::instruction::initialize_permanent_delegate(&t22, &bond, &pda).unwrap(),
        ];
        if options.metadata {
            ixs.push(
                spl_token_2022::extension::metadata_pointer::instruction::initialize(
                    &t22,
                    &bond,
                    Some(issuer),
                    Some(bond),
                )
                .unwrap(),
            );
        }
        if options.forbidden_extension {
            ixs.push(
                spl_token_2022::instruction::initialize_mint_close_authority(
                    &t22,
                    &bond,
                    Some(&issuer),
                )
                .unwrap(),
            );
        }
        ixs.push(
            spl_token_2022::instruction::initialize_mint2(
                &t22,
                &bond,
                &mint_authority,
                Some(&pda),
                0,
            )
            .unwrap(),
        );
        if options.metadata {
            ixs.push(spl_token_metadata_interface::instruction::initialize(
                &t22,
                &bond,
                &issuer,
                &bond,
                &issuer,
                "Steppe Energy 2028".into(),
                "STPE.28".into(),
                String::new(),
            ));
            ixs.push(
                spl_token_2022::instruction::set_authority(
                    &t22,
                    &bond,
                    Some(&pda),
                    AuthorityType::MintTokens,
                    &issuer,
                    &[],
                )
                .unwrap(),
            );
        }
        let cash_rent = env.svm.minimum_balance_for_rent_exemption(82);
        ixs.push(system_instruction::create_account(
            &issuer, &cash, cash_rent, 82, &spl,
        ));
        ixs.push(spl_token::instruction::initialize_mint2(&spl, &cash, &issuer, None, 6).unwrap());
        env.send(ixs, &[&bond_kp, &cash_kp]).unwrap();

        let budget = 30 * FACE + 2 * 1_500_000_000 + RESIDUAL;
        let mut ixs = vec![
            create_ata(&issuer, &pda, &cash, &spl),
            create_ata(&issuer, &issuer, &cash, &spl),
            spl_token::instruction::mint_to_checked(
                &spl,
                &cash,
                &env.vault,
                &issuer,
                &[],
                budget,
                6,
            )
            .unwrap(),
        ];
        for h in env.holders.iter().map(key).collect::<Vec<_>>() {
            ixs.push(create_ata(&issuer, &h, &bond, &t22));
            ixs.push(create_ata(&issuer, &h, &cash, &spl));
        }
        env.send(ixs, &[]).unwrap();
        env.attached = env.program_ix(Ix::AttachTokens, None);
        env
    }

    fn at(&mut self, time: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = time;
        clock.slot += 1;
        self.svm.set_sysvar(&clock);
    }

    /// Accounts in the order `server/chain.mjs` `tokenKeys` sends them.
    fn token_keys(&self, ix: &Ix) -> Vec<AccountMeta> {
        let common = vec![
            AccountMeta::new_readonly(self.pda, false),
            AccountMeta::new(self.bond, false),
        ];
        let settlement = |mut v: Vec<AccountMeta>| {
            v.extend([
                AccountMeta::new_readonly(self.cash, false),
                AccountMeta::new(self.vault, false),
                AccountMeta::new_readonly(spl_token_2022::id(), false),
                AccountMeta::new_readonly(spl_token::id(), false),
            ]);
            v
        };
        match ix {
            Ix::Transfer { from, to, .. } => {
                let mut v = common;
                v.extend([
                    AccountMeta::new_readonly(spl_token_2022::id(), false),
                    AccountMeta::new(self.bonds[*from as usize], false),
                    AccountMeta::new(self.bonds[*to as usize], false),
                ]);
                v
            }
            Ix::Confirm { holder } => {
                let mut v = settlement(common);
                v.push(AccountMeta::new(self.bonds[*holder as usize], false));
                v.push(AccountMeta::new(self.cashes[*holder as usize], false));
                v
            }
            Ix::AttachTokens => {
                let mut v = settlement(common);
                v.extend(self.bonds.iter().map(|b| AccountMeta::new(*b, false)));
                v
            }
            Ix::Withdraw => vec![
                AccountMeta::new_readonly(self.pda, false),
                AccountMeta::new_readonly(self.cash, false),
                AccountMeta::new(self.vault, false),
                AccountMeta::new_readonly(spl_token::id(), false),
                AccountMeta::new(ata(&key(&self.issuer), &self.cash, &spl_token::id()), false),
            ],
            _ => vec![],
        }
    }

    fn ix(
        &self,
        data: &Ix,
        signer: &Pubkey,
        keys: Vec<AccountMeta>,
        state_signs: bool,
    ) -> Instruction {
        let mut accounts = vec![
            AccountMeta::new(key(&self.state), state_signs),
            AccountMeta::new_readonly(*signer, true),
        ];
        accounts.extend(keys);
        Instruction {
            program_id: self.program,
            accounts,
            data: borsh::to_vec(data).unwrap(),
        }
    }

    fn send(&mut self, ixs: Vec<Instruction>, extra: &[&Keypair]) -> Result<(), String> {
        let mut signers = vec![&self.issuer];
        signers.extend_from_slice(extra);
        let tx = Transaction::new_signed_with_payer(
            &ixs.into_iter().map(convert).collect::<Vec<_>>(),
            Some(&self.issuer.pubkey()),
            &signers,
            self.svm.latest_blockhash(),
        );
        let result = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        result.map(|_| ()).map_err(|e| e.meta.logs.join("\n"))
    }

    /// Sends a program instruction signed by the issuer, or by holder `by`.
    fn program_ix(&mut self, data: Ix, by: Option<usize>) -> Result<(), String> {
        let keys = self.token_keys(&data);
        let signer = by.map(|i| self.holders[i].insecure_clone());
        let signer_key = signer.as_ref().map(key).unwrap_or(key(&self.issuer));
        let ix = self.ix(&data, &signer_key, keys, false);
        match &signer {
            Some(s) => self.send(vec![ix], &[s]),
            None => self.send(vec![ix], &[]),
        }
    }
    fn issuer(&mut self, data: Ix) -> Result<(), String> {
        self.program_ix(data, None)
    }

    fn instrument(&self) -> Instrument {
        let account = self.svm.get_account(&addr(&key(&self.state))).unwrap();
        Instrument::deserialize(&mut &account.data[..]).unwrap()
    }
    fn cash_balance(&self, account: &Pubkey) -> u64 {
        let a = self.svm.get_account(&addr(account)).unwrap();
        spl_token::state::Account::unpack(&a.data).unwrap().amount
    }
    fn bond_balance(&self, holder: usize) -> u64 {
        let a = self.svm.get_account(&addr(&self.bonds[holder])).unwrap();
        StateWithExtensions::<BondAccount>::unpack(&a.data)
            .unwrap()
            .base
            .amount
    }
    fn bond_supply(&self) -> u64 {
        let a = self.svm.get_account(&addr(&self.bond)).unwrap();
        StateWithExtensions::<BondMint>::unpack(&a.data)
            .unwrap()
            .base
            .supply
    }

    fn schedule(&mut self, kind: u8, period: u8, bps: u16, record_at: i64) -> Result<(), String> {
        self.issuer(Ix::Schedule {
            kind,
            period,
            bps,
            record_at,
        })
    }
    /// Snapshot, initiate and pay every row of the latest action at `time`.
    fn settle(&mut self, time: i64) {
        self.at(time);
        self.issuer(Ix::Snapshot).unwrap();
        self.issuer(Ix::Initiate).unwrap();
        let rows: Vec<u8> = self
            .instrument()
            .actions
            .last()
            .unwrap()
            .rows
            .iter()
            .map(|r| r.holder)
            .collect();
        for holder in rows {
            self.issuer(Ix::Confirm { holder }).unwrap();
        }
    }
}

fn expect_err(result: Result<(), String>, message: &str) {
    let logs = result.expect_err(&format!("expected failure: {message}"));
    assert!(
        logs.contains(message),
        "expected `{message}` in logs:\n{logs}"
    );
}

#[test]
fn full_lifecycle_pays_burns_and_releases_residual() {
    let mut env = Env::new(Options::default());
    env.attached.clone().unwrap();
    assert_eq!(env.bond_supply(), 30);

    env.at(T0 + 100);
    env.program_ix(
        Ix::Transfer {
            from: 0,
            to: 1,
            units: 4,
        },
        Some(0),
    )
    .unwrap();
    assert_eq!((env.bond_balance(0), env.bond_balance(1)), (6, 24));

    env.schedule(0, 1, 0, T0 + 500).unwrap();
    env.at(T0 + 500);
    expect_err(
        env.program_ix(
            Ix::Transfer {
                from: 1,
                to: 0,
                units: 1,
            },
            Some(1),
        ),
        "Record-date transfer lock",
    );
    env.issuer(Ix::Snapshot).unwrap();
    env.issuer(Ix::Initiate).unwrap();
    expect_err(
        env.program_ix(Ix::Confirm { holder: 0 }, Some(1)),
        "Issuer authority required",
    );
    env.issuer(Ix::Confirm { holder: 0 }).unwrap();
    env.program_ix(Ix::Confirm { holder: 1 }, Some(1)).unwrap();
    expect_err(
        env.issuer(Ix::Confirm { holder: 1 }),
        "Settlement not initiated",
    );
    assert_eq!(env.cash_balance(&env.cashes[0]), 300_000_000);
    assert_eq!(env.cash_balance(&env.cashes[1]), 1_200_000_000);

    expect_err(
        env.issuer(Ix::Withdraw),
        "Escrow is released only after full redemption",
    );

    env.at(T0 + 600);
    env.schedule(2, 0, 5000, T0 + 700).unwrap();
    env.settle(T0 + 700);
    assert_eq!((env.bond_balance(0), env.bond_balance(1)), (3, 12));
    assert_eq!(env.bond_supply(), 15);

    env.at(T0 + 800);
    expect_err(
        env.schedule(1, 0, 10_000, T0 + 1000),
        "Settle all coupon periods",
    );
    env.schedule(0, 2, 0, T0 + 1000).unwrap();
    env.settle(T0 + 1000);
    env.schedule(1, 0, 10_000, T0 + 1000).unwrap();
    env.settle(T0 + 1000);
    assert_eq!(env.bond_supply(), 0);
    let s = env.instrument();
    assert_eq!((s.supply, s.retired), (0, 30));

    // Budget covered full coupons on 30 bonds; the partial redemption left 750 USD unused.
    let residual = 750_000_000 + RESIDUAL;
    assert_eq!(env.cash_balance(&env.vault), residual);
    expect_err(
        env.program_ix(Ix::Withdraw, Some(0)),
        "Issuer authority required",
    );
    env.issuer(Ix::Withdraw).unwrap();
    assert_eq!(env.cash_balance(&env.vault), 0);
    let issuer_cash = ata(&key(&env.issuer), &env.cash, &spl_token::id());
    assert_eq!(env.cash_balance(&issuer_cash), residual);
    expect_err(env.issuer(Ix::Withdraw), "Escrow is empty");
}

#[test]
fn record_date_must_be_close_to_the_obligation() {
    let mut env = Env::new(Options::default());
    let due = T0 + 500;
    expect_err(env.schedule(0, 1, 0, due - 1), "Coupon period not due");
    expect_err(
        env.schedule(0, 1, 0, due + 31 * 86_400),
        "Record date too far",
    );
    env.schedule(0, 1, 0, due + 29 * 86_400).unwrap();
}

#[test]
fn unpaid_action_can_be_cancelled_and_rescheduled() {
    let mut env = Env::new(Options::default());
    env.schedule(0, 1, 0, T0 + 500).unwrap();
    expect_err(
        env.program_ix(Ix::Cancel, Some(0)),
        "Issuer authority required",
    );
    env.at(T0 + 500);
    env.issuer(Ix::Snapshot).unwrap();
    env.issuer(Ix::Cancel).unwrap();
    assert!(env.instrument().actions.is_empty());
    // Transfers are unlocked again once the pending record date is withdrawn.
    env.program_ix(
        Ix::Transfer {
            from: 0,
            to: 1,
            units: 1,
        },
        Some(0),
    )
    .unwrap();

    env.schedule(0, 1, 0, T0 + 600).unwrap();
    env.at(T0 + 600);
    env.issuer(Ix::Snapshot).unwrap();
    env.issuer(Ix::Initiate).unwrap();
    env.issuer(Ix::Confirm { holder: 0 }).unwrap();
    expect_err(
        env.issuer(Ix::Cancel),
        "Only an unpaid action can be cancelled",
    );
}

#[test]
fn partial_redemption_must_retire_a_whole_bond() {
    let mut env = Env::new(Options::default());
    expect_err(env.schedule(2, 0, 100, T0 + 100), "retires no whole bond");
    env.schedule(2, 0, 500, T0 + 100).unwrap();
}

#[test]
fn frozen_bonds_cannot_bypass_the_registry() {
    let mut env = Env::new(Options::default());
    let t22 = spl_token_2022::id();
    let ix = spl_token_2022::instruction::transfer_checked(
        &t22,
        &env.bonds[0],
        &env.bond,
        &env.bonds[1],
        &key(&env.holders[0]),
        &[],
        1,
        0,
    )
    .unwrap();
    let holder = env.holders[0].insecure_clone();
    assert!(env.send(vec![ix], &[&holder]).is_err());
    assert_eq!(env.bond_balance(0), 10);
}

#[test]
fn bond_mint_may_carry_display_metadata() {
    let env = Env::new(Options {
        metadata: true,
        ..Default::default()
    });
    env.attached.clone().unwrap();
    assert_eq!(env.bond_supply(), 30);
}

#[test]
fn bond_mint_rejects_other_extensions() {
    let env = Env::new(Options {
        forbidden_extension: true,
        ..Default::default()
    });
    expect_err(env.attached.clone(), "Unexpected bond mint extensions");
}
