import * as fs from "fs";
import * as path from "path";
import os from "os";

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
	createV1,
	findMetadataPda,
	mplTokenMetadata,
	TokenStandard,
} from "@metaplex-foundation/mpl-token-metadata";
import {
	keypairIdentity,
	percentAmount,
	publicKey,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";

// RPC endpoint (Devnet by default)
const RPC_ENDPOINT =
	process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";

// Your LUMI mint (SPL-Token, 6 dec). MUST have this wallet as mint authority.
const LUMI_MINT = publicKey(
	process.env.LUMI_MINT || "DRfReSvGUqqqpnmC49GqsRBCVZqG8ihhwVsmAf6SQRJk"
);

// Your Pinata metadata URI
const METADATA_URI =
	"https://harlequin-legislative-sparrow-672.mypinata.cloud/ipfs/bafybeigs6yytpfslgtng7trr2az4nreszkksezbwip22ftmkhe7c7q2f2a";

// Path to Solana CLI keypair (same one Anchor uses)
const WALLET_PATH =
	process.env.ANCHOR_WALLET ||
	path.join(os.homedir(), ".config", "solana", "id.json");

function loadUmiWithKeypair() {
	const umi = createUmi(RPC_ENDPOINT).use(mplTokenMetadata());

	const raw = JSON.parse(fs.readFileSync(WALLET_PATH, "utf8")) as number[];
	const secret = new Uint8Array(raw);
	const kp = umi.eddsa.createKeypairFromSecretKey(secret);

	umi.use(keypairIdentity(kp));
	return umi;
}

async function main() {
	const umi = loadUmiWithKeypair();

	console.log("Using wallet:", umi.identity.publicKey.toString());
	console.log("Mint:", LUMI_MINT.toString());
	console.log("Metadata URI:", METADATA_URI);

	// Derive metadata PDA (not strictly required to log but useful for debugging)
	const metadataPda = await findMetadataPda(umi, {
		mint: LUMI_MINT,
	});

	// Sample metadata for our token
	const tokenMetadata = {
		name: "LUMI",
		symbol: "LUMI",
		uri: METADATA_URI,
	};

	// NOTE:
	// This script requires that the signer (ANCHOR_WALLET) is the mint authority for LUMI_MINT.
	// If you see InvalidMintAuthority from mplTokenMetadata, create a new mint where your wallet
	// is the mint authority, set LUMI_MINT to that address, and re-run this script.

	// Create or overwrite metadata using createV1 helper
	const tx = await createV1(umi, {
		mint: LUMI_MINT,
		authority: umi.identity,
		payer: umi.identity,
		updateAuthority: umi.identity,
		name: tokenMetadata.name,
		symbol: tokenMetadata.symbol,
		uri: tokenMetadata.uri,
		sellerFeeBasisPoints: percentAmount(0),
		tokenStandard: TokenStandard.Fungible,
	}).sendAndConfirm(umi);

	const txSig = base58.deserialize(tx.signature);
	console.log(
		`Metadata created/updated. Explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`
	);
	console.log("Metadata PDA:", metadataPda.toString());
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
