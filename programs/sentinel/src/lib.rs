use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

const COMP_DEF_OFFSET_INIT_RISK_STATE: u32 = comp_def_offset("init_risk_state");
const COMP_DEF_OFFSET_CHECK_HEALTH: u32 = comp_def_offset("check_position_health");
const COMP_DEF_OFFSET_REVEAL_RISK: u32 = comp_def_offset("reveal_risk");

declare_id!("SentDeFi11111111111111111111111111111111111");

#[arcium_program]
pub mod sentinel {
    use super::*;

    // ─── Computation Definition Initializers ───

    pub fn init_risk_state_comp_def(ctx: Context<InitRiskStateCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_check_health_comp_def(ctx: Context<InitCheckHealthCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn init_reveal_risk_comp_def(ctx: Context<InitRevealRiskCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    // ─── Register Position ───

    /// Registers a new position for monitoring. Creates the position account
    /// and initializes encrypted risk state via MPC.
    pub fn register_position(
        ctx: Context<RegisterPosition>,
        computation_offset: u64,
        position_id: u32,
        nonce: u128,
    ) -> Result<()> {
        msg!("Registering position for monitoring");

        ctx.accounts.position_acc.bump = ctx.bumps.position_acc;
        ctx.accounts.position_acc.position_id = position_id;
        ctx.accounts.position_acc.owner = ctx.accounts.payer.key();
        ctx.accounts.position_acc.nonce = nonce;
        ctx.accounts.position_acc.risk_state = [[0; 32]; 2];
        ctx.accounts.position_acc.last_check = 0;
        ctx.accounts.position_acc.is_active = true;

        let args = ArgBuilder::new().plaintext_u128(nonce).build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![InitRiskStateCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.position_acc.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_risk_state")]
    pub fn init_risk_state_callback(
        ctx: Context<InitRiskStateCallback>,
        output: SignedComputationOutputs<InitRiskStateOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(InitRiskStateOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        ctx.accounts.position_acc.risk_state = o.ciphertexts;
        ctx.accounts.position_acc.nonce = o.nonce;

        emit!(PositionRegistered {
            owner: ctx.accounts.position_acc.owner,
            position_id: ctx.accounts.position_acc.position_id,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // ─── Check Health ───

    /// Submits encrypted position data for a privacy-preserving health check.
    /// The MPC nodes compute risk without seeing actual position values.
    pub fn check_health(
        ctx: Context<CheckHealth>,
        computation_offset: u64,
        _position_id: u32,
        encrypted_position: [[u8; 32]; 3], // 3 fields: value, collateral_ratio, threshold
        encryption_pubkey: [u8; 32],
        encryption_nonce: u128,
    ) -> Result<()> {
        require!(ctx.accounts.position_acc.is_active, ErrorCode::PositionInactive);

        let args = ArgBuilder::new()
            .x25519_pubkey(encryption_pubkey)
            .plaintext_u128(encryption_nonce)
            .encrypted_u64(encrypted_position[0])
            .encrypted_u64(encrypted_position[1])
            .encrypted_u64(encrypted_position[2])
            .plaintext_u128(ctx.accounts.position_acc.nonce)
            .account(
                ctx.accounts.position_acc.key(),
                // 8 (discriminator) + 1 (bump)
                8 + 1,
                32 * 2, // risk_state: 2 x 32-byte ciphertexts
            )
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![CheckPositionHealthCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.position_acc.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "check_position_health")]
    pub fn check_position_health_callback(
        ctx: Context<CheckPositionHealthCallback>,
        output: SignedComputationOutputs<CheckPositionHealthOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CheckPositionHealthOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        ctx.accounts.position_acc.risk_state = o.ciphertexts;
        ctx.accounts.position_acc.nonce = o.nonce;
        ctx.accounts.position_acc.last_check = Clock::get()?.unix_timestamp;

        emit!(HealthCheckCompleted {
            owner: ctx.accounts.position_acc.owner,
            position_id: ctx.accounts.position_acc.position_id,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    // ─── Reveal Risk ───

    /// Reveals whether the position is at risk. Only the position owner can call this.
    pub fn reveal_risk(
        ctx: Context<RevealRisk>,
        computation_offset: u64,
        position_id: u32,
    ) -> Result<()> {
        require!(
            ctx.accounts.payer.key() == ctx.accounts.position_acc.owner,
            ErrorCode::InvalidAuthority
        );

        msg!("Revealing risk status for position {}", position_id);

        let args = ArgBuilder::new()
            .plaintext_u128(ctx.accounts.position_acc.nonce)
            .account(
                ctx.accounts.position_acc.key(),
                8 + 1,
                32 * 2,
            )
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![RevealRiskCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;

        Ok(())
    }

    #[arcium_callback(encrypted_ix = "reveal_risk")]
    pub fn reveal_risk_callback(
        ctx: Context<RevealRiskCallback>,
        output: SignedComputationOutputs<RevealRiskOutput>,
    ) -> Result<()> {
        let o = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(RevealRiskOutput { field_0 }) => field_0,
            Err(_) => return Err(ErrorCode::AbortedComputation.into()),
        };

        emit!(RiskRevealed {
            is_at_risk: o,
            timestamp: Clock::get()?.unix_timestamp,
        });

        if o {
            emit!(ActionRequired {
                action_type: "emergency_withdraw".to_string(),
                timestamp: Clock::get()?.unix_timestamp,
            });
        }

        Ok(())
    }
}

// ─── Account Structs ───

#[queue_computation_accounts("init_risk_state", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, position_id: u32)]
pub struct RegisterPosition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_RISK_STATE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        init,
        payer = payer,
        space = 8 + PositionAccount::INIT_SPACE,
        seeds = [b"position", payer.key().as_ref(), position_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub position_acc: Account<'info, PositionAccount>,
}

#[callback_accounts("init_risk_state")]
#[derive(Accounts)]
pub struct InitRiskStateCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_RISK_STATE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub position_acc: Account<'info, PositionAccount>,
}

#[init_computation_definition_accounts("init_risk_state", payer)]
#[derive(Accounts)]
pub struct InitRiskStateCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("check_position_health", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, _position_id: u32)]
pub struct CheckHealth<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_HEALTH))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
    /// CHECK: Position owner
    #[account(address = position_acc.owner)]
    pub owner: UncheckedAccount<'info>,
    #[account(
        seeds = [b"position", owner.key().as_ref(), _position_id.to_le_bytes().as_ref()],
        bump = position_acc.bump,
        has_one = owner
    )]
    pub position_acc: Account<'info, PositionAccount>,
}

#[callback_accounts("check_position_health")]
#[derive(Accounts)]
pub struct CheckPositionHealthCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CHECK_HEALTH))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub position_acc: Account<'info, PositionAccount>,
}

#[init_computation_definition_accounts("check_position_health", payer)]
#[derive(Accounts)]
pub struct InitCheckHealthCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("reveal_risk", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64, position_id: u32)]
pub struct RevealRisk<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_RISK))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        seeds = [b"position", payer.key().as_ref(), position_id.to_le_bytes().as_ref()],
        bump = position_acc.bump
    )]
    pub position_acc: Account<'info, PositionAccount>,
}

#[callback_accounts("reveal_risk")]
#[derive(Accounts)]
pub struct RevealRiskCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_REVEAL_RISK))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
}

#[init_computation_definition_accounts("reveal_risk", payer)]
#[derive(Accounts)]
pub struct InitRevealRiskCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    /// CHECK: address_lookup_table
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

// ─── State ───

/// Represents a monitored DeFi position with encrypted risk state.
#[account]
#[derive(InitSpace)]
pub struct PositionAccount {
    /// PDA bump seed
    pub bump: u8,
    /// Encrypted risk state: [is_at_risk, severity] as 32-byte ciphertexts
    pub risk_state: [[u8; 32]; 2],
    /// Unique position identifier
    pub position_id: u32,
    /// Owner's public key
    pub owner: Pubkey,
    /// Cryptographic nonce for re-encryption
    pub nonce: u128,
    /// Unix timestamp of last health check
    pub last_check: i64,
    /// Whether the position is actively monitored
    pub is_active: bool,
}

// ─── Errors ───

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Position is not active")]
    PositionInactive,
}

// ─── Events ───

#[event]
pub struct PositionRegistered {
    pub owner: Pubkey,
    pub position_id: u32,
    pub timestamp: i64,
}

#[event]
pub struct HealthCheckCompleted {
    pub owner: Pubkey,
    pub position_id: u32,
    pub timestamp: i64,
}

#[event]
pub struct RiskRevealed {
    pub is_at_risk: bool,
    pub timestamp: i64,
}

#[event]
pub struct ActionRequired {
    pub action_type: String,
    pub timestamp: i64,
}
