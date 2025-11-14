# LUMI Devnet Deployment Notes (Updated)

### Current LUMI Devnet Deployment (Active)
- **Wallet (authority):** `GtJg94gHJ2azqjCTPqQZuHbG3kBSA3JZ33xSmKa3V7Fj`
- **Program ID (devnet):** `DkVEJV8J2biu2jUBibqUHAzvupfP1XSMMXuARNAe2piM`
- **IDL account (on-chain):** `2gobHj4ScHziyKbgWAoidGua8pGPe3P5orrpC28WTpPg`
- **Config account:** `711TpNNmDj1QuBocMnQvJRjJ2sM8yn4BQ9gkwFj1YtwZ`
- **Mint (SPL-Token, 6 dec):** `DRfReSvGUqqqpnmC49GqsRBCVZqG8ihhwVsmAf6SQRJk`
- **Mint authority PDA:** `GZc4AZQ9GzuCiaYqEWrjyqqCPMuDc9s4BKDLYGH1p58R` *(bump 253)*
- **Issuer PDA (for wallet):** `Br2LcsCtskmPRdn3noszenYe3wM2gAJhHSTh94tfC12B`
- **Token Program in use:** `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` *(SPL-Token / legacy)*
- **RPC URL:** `https://api.devnet.solana.com`
- **Saved config file:** `target/config.json`
- **IDL file (local):** `target/idl/lumi.json`
- **Program keypair file (BACK THIS UP):** `target/deploy/lumi-keypair.json`

### Quick Reference Commands

```bash
# issue whole LUMI tokens
RECIPIENT=GtJg94gHJ2azqjCTPqQZuHbG3kBSA3JZ33xSmKa3V7Fj
npx ts-node scripts/lumi.ts --issue $RECIPIENT 5

# decimal amounts
npx ts-node scripts/lumi.ts --issue $RECIPIENT 1.25 --cid "note"

# raw base units (u64)
npx ts-node scripts/lumi.ts --issue $RECIPIENT 5000000 --base-units

# check balance
spl-token balance $LUMI_MINT --owner $RECIPIENT
```