import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Shared Solana config for the LUMI frontend.
 *
 * All values are driven by NEXT_PUBLIC_* env vars so you can
 * swap clusters or mints without touching code.
 */

export const RPC_ENDPOINT =
	process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";

export const connection = new Connection(RPC_ENDPOINT, "confirmed");

// Anchor program ID on devnet
export const PROGRAM_ID = new PublicKey(
	process.env.NEXT_PUBLIC_PROGRAM_ID ||
		"DkVEJV8J2biu2jUBibqUHAzvupfP1XSMMXuARNAe2piM"
);

// LUMI mint (SPL-Token, 6 decimals) — NEW_LUMI_MINT
export const LUMI_MINT = new PublicKey(
	process.env.NEXT_PUBLIC_LUMI_MINT ||
		"DRfReSvGUqqqpnmC49GqsRBCVZqG8ihhwVsmAf6SQRJk"
);

// Legacy SPL-Token program (Tokenkeg…)
export const SPL_TOKEN_PROGRAM_ID = new PublicKey(
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);