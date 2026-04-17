use anchor_lang::prelude::*;
use crate::state::Pool;
use crate::errors::RegistryError;

#[derive(Accounts)]
#[instruction(namespace: [u8; 32])]
pub struct CreatePool<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Pool::INIT_SPACE,
        seeds = [b"pool", namespace.as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreatePool>,
    namespace: [u8; 32],
    write_fee: u64,
    citation_fee: u64,
) -> Result<()> {
    // Namespace must start with a non-zero byte (i.e. must be non-empty).
    require!(namespace[0] != 0, RegistryError::InvalidPoolNamespace);

    // Derive the treasury PDA bump without creating the treasury account itself.
    // The SPL ATA for this treasury PDA is created lazily via the CLI in Task 4.2.
    let (_treasury_key, treasury_bump) = Pubkey::find_program_address(
        &[b"treasury", ctx.accounts.pool.key().as_ref()],
        ctx.program_id,
    );

    let pool = &mut ctx.accounts.pool;
    pool.authority = ctx.accounts.authority.key();
    pool.namespace = namespace;
    pool.write_fee = write_fee;
    pool.citation_fee = citation_fee;
    pool.memory_count = 0;
    pool.citation_count = 0;
    pool.treasury_bump = treasury_bump;
    pool.bump = ctx.bumps.pool;
    pool._reserved = [0; 32];

    // Log the namespace as UTF-8 if possible (trim null padding).
    let ns_end = namespace.iter().position(|&b| b == 0).unwrap_or(32);
    let ns_str = std::str::from_utf8(&namespace[..ns_end]).unwrap_or("<non-utf8>");
    msg!(
        "Pool created: namespace=\"{}\" write_fee={} citation_fee={}",
        ns_str,
        write_fee,
        citation_fee
    );

    Ok(())
}
