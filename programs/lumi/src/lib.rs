use anchor_lang::prelude::*;
use anchor_spl::token as spl_token;               // legacy SPL-Token
use anchor_spl::token_2022 as spl_token_2022;     // Token-2022
use anchor_spl::token_interface as ti;            // interface types shared by both

declare_id!("BPDM9Ls3NU3JohLeTxxULbZzK4yUmqt5H2mRUCTms3R7");

#[program]
pub mod lumi {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, daily_cap_per_issuer: u64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.lumi_mint = ctx.accounts.lumi_mint.key();
        config.mint_authority_bump = ctx.bumps.mint_authority;
        config.daily_cap_per_issuer = daily_cap_per_issuer;
        Ok(())
    }

    pub fn add_issuer(ctx: Context<AddIssuer>) -> Result<()> {
        let issuer = &mut ctx.accounts.issuer;
        issuer.wallet = ctx.accounts.issuer_wallet.key();
        issuer.issued_today = 0;
        issuer.last_issue_day = 0;
        issuer.active = true;
        Ok(())
    }

    pub fn issue_lumi(ctx: Context<IssueLumi>, amount: u64, reason_code: [u8;8], ipfs_cid: String) -> Result<()> {
        let clock = Clock::get()?;
        let day = (clock.unix_timestamp as u64) / 86_400;
        let config = &ctx.accounts.config;
        let issuer = &mut ctx.accounts.issuer;

        require!(issuer.active, LumiError::IssuerInactive);
        if issuer.last_issue_day != day {
            issuer.last_issue_day = day;
            issuer.issued_today = 0;
        }
        require!(issuer.issued_today.saturating_add(amount) <= config.daily_cap_per_issuer, LumiError::DailyCapExceeded);

        // Mint LUMI using PDA as mint authority
		let cfg_key = config.key();
        let seeds: &[&[u8]] = &[
            b"mint_authority",
            cfg_key.as_ref(),
            &[config.mint_authority_bump],
        ];
         let signer: &[&[&[u8]]] = &[seeds];

        let cpi_accounts = spl_token_2022::MintTo {
            mint: ctx.accounts.lumi_mint.to_account_info(),
            to: ctx.accounts.to_ata.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        spl_token_2022::mint_to(cpi_ctx, amount)?;

        issuer.issued_today = issuer.issued_today.saturating_add(amount);

        emit!(LumiIssued {
            issuer: issuer.wallet,
            to: ctx.accounts.to.key(),
            amount,
            reason_code,
            ipfs_cid,
        });
        Ok(())
    }

    pub fn issue_lumi_legacy(ctx: Context<IssueLumiLegacy>, amount: u64, reason_code: [u8;8], ipfs_cid: String) -> Result<()> {
        let clock = Clock::get()?;
        let day = (clock.unix_timestamp as u64) / 86_400;
        let config = &ctx.accounts.config;
        let issuer = &mut ctx.accounts.issuer;

        require!(issuer.active, LumiError::IssuerInactive);
        if issuer.last_issue_day != day {
            issuer.last_issue_day = day;
            issuer.issued_today = 0;
        }
        require!(issuer.issued_today.saturating_add(amount) <= config.daily_cap_per_issuer, LumiError::DailyCapExceeded);

        // PDA signer seeds
		let cfg_key = config.key();
        let seeds: &[&[u8]] = &[
            b"mint_authority",
            cfg_key.as_ref(),
            &[config.mint_authority_bump],
        ];
         let signer: &[&[&[u8]]] = &[seeds];

        // CPI into legacy SPL-Token program
        let cpi_accounts = spl_token::MintTo {
            mint: ctx.accounts.lumi_mint.to_account_info(),
            to: ctx.accounts.to_ata.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        spl_token::mint_to(cpi_ctx, amount)?;

        issuer.issued_today = issuer.issued_today.saturating_add(amount);

        emit!(LumiIssued {
            issuer: issuer.wallet,
            to: ctx.accounts.to.key(),
            amount,
            reason_code,
            ipfs_cid,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: PDA used as mint authority signer
    #[account(
        seeds = [b"mint_authority", config.key().as_ref()],
        bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub lumi_mint: InterfaceAccount<'info, ti::Mint>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::SIZE,
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, spl_token_2022::Token2022>,
}

#[derive(Accounts)]
pub struct AddIssuer<'info> {
    #[account(mut, address = config.admin)]
    pub admin: Signer<'info>,

    #[account(mut)]
    pub config: Account<'info, Config>,

    /// PDA: issuer record bound to wallet
    #[account(
        init,
        payer = admin,
        space = 8 + Issuer::SIZE,
        seeds = [b"issuer", config.key().as_ref(), issuer_wallet.key().as_ref()],
        bump,
    )]
    pub issuer: Account<'info, Issuer>,

    /// CHECK: the issuer's wallet
    pub issuer_wallet: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct IssueLumi<'info> {
    /// issuer must sign and must match `issuer.wallet`
    #[account(mut)]
    pub wallet: Signer<'info>,

    #[account(mut)]
    pub config: Account<'info, Config>,

    /// CHECK: PDA that signs mint_to
    #[account(
        seeds = [b"mint_authority", config.key().as_ref()],
        bump = config.mint_authority_bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"issuer", config.key().as_ref(), wallet.key().as_ref()],
        bump,
        has_one = wallet @ LumiError::Unauthorized
    )]
    pub issuer: Account<'info, Issuer>,

    /// Recipient
    /// CHECK: just a pubkey receiver; ATA must exist or be created client-side
    pub to: UncheckedAccount<'info>,

    #[account(mut)]
    pub lumi_mint: InterfaceAccount<'info, ti::Mint>,

    #[account(mut)]
    pub to_ata: InterfaceAccount<'info, ti::TokenAccount>,

    pub token_program: Program<'info, spl_token_2022::Token2022>,
}

#[derive(Accounts)]
pub struct IssueLumiLegacy<'info> {
    /// issuer must sign and must match `issuer.wallet`
    #[account(mut)]
    pub wallet: Signer<'info>,

    #[account(mut)]
    pub config: Account<'info, Config>,

    /// CHECK: PDA that signs mint_to
    #[account(
        seeds = [b"mint_authority", config.key().as_ref()],
        bump = config.mint_authority_bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"issuer", config.key().as_ref(), wallet.key().as_ref()],
        bump,
        has_one = wallet @ LumiError::Unauthorized
    )]
    pub issuer: Account<'info, Issuer>,

    /// Recipient
    /// CHECK: just a pubkey receiver; ATA must exist or be created client-side
    pub to: UncheckedAccount<'info>,

    #[account(mut)]
    pub lumi_mint: InterfaceAccount<'info, ti::Mint>,

    #[account(mut)]
    pub to_ata: InterfaceAccount<'info, ti::TokenAccount>,

    pub token_program: Program<'info, spl_token::Token>,
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub lumi_mint: Pubkey,
    pub mint_authority_bump: u8,
    pub daily_cap_per_issuer: u64,
}
impl Config { pub const SIZE: usize = 32 + 32 + 1 + 8; }

#[account]
pub struct Issuer {
    pub wallet: Pubkey,
    pub issued_today: u64,
    pub last_issue_day: u64,
    pub active: bool,
}
impl Issuer { pub const SIZE: usize = 32 + 8 + 8 + 1; }

#[event]
pub struct LumiIssued {
    pub issuer: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub reason_code: [u8; 8],
    pub ipfs_cid: String,
}

#[error_code]
pub enum LumiError {
    #[msg("Issuer is inactive")] IssuerInactive,
    #[msg("Daily cap exceeded")] DailyCapExceeded,
    #[msg("Unauthorized")] Unauthorized,
}
