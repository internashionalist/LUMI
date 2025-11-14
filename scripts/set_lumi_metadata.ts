import * as fs from "fs";
import * as path from "path";
import os from "os";

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
	updateV1,
	findMetadataPda,
	mplTokenMetadata,
	fetchMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import {
	keypairIdentity,
	publicKey,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";

const RPC_ENDPOINT =
	process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";

const LUMI_MINT = publicKey("DRfReSvGUqqqpnmC49GqsRBCVZqG8ihhwVsmAf6SQRJk");

// hosted on Pinata
const METADATA_URI =
"https://harlequin-legislative-sparrow-672.mypinata.cloud/ipfs/bafkreibt56yswhmfao7gh7css7qlgkvkz5mpnsyljvkapfksca3bfr4r2q";

// path to CLI wallet keypair
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

	const metadataPda = await findMetadataPda(umi, {
		mint: LUMI_MINT,
	});

	const tokenMetadata = {
		name: "LUMI",
		symbol: "LUMI",
		image: "https://harlequin-legislative-sparrow-672.mypinata.cloud/ipfs/bafybeigs6yytpfslgtng7trr2az4nreszkksezbwip22ftmkhe7c7q2f2a",
		uri: METADATA_URI,
	};

	const existingMetadata = await fetchMetadata(umi, metadataPda);

	const updatedData: any = {
		name: tokenMetadata.name,
		symbol: tokenMetadata.symbol,
		uri: tokenMetadata.uri,
		sellerFeeBasisPoints: (existingMetadata as any).sellerFeeBasisPoints,
		creators: (existingMetadata as any).creators,
		collection: (existingMetadata as any).collection,
		uses: (existingMetadata as any).uses,
	};

	console.log("Existing metadata found; preserving creators, collection, and uses.");

	const tx = await updateV1(umi, {
		mint: LUMI_MINT,
		authority: umi.identity,
		data: updatedData,
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
