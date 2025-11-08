import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

// NOTE: Replace with the generated IDL name if needed
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { IDL } from "../target/idl/lumi.json";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const programId = new PublicKey("REPLACE_WITH_DEPLOYED_PROGRAM_ID");
const program = new anchor.Program(IDL as any, programId, provider);

(async () => {
  const admin = (provider.wallet as anchor.Wallet).payer;

  // Derive config + mint authority PDA
  const config = anchor.web3.Keypair.generate();
  const [mintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority"), config.publicKey.toBuffer()],
    program.programId
  );

  // Create a token-2022 mint beforehand (script) and put pubkey here
  const LUMI_MINT = new PublicKey(process.env.LUMI_MINT!);

  await program.methods
    .initializeConfig(new anchor.BN(1_000_000))
    .accounts({
      admin: provider.wallet.publicKey,
      mintAuthority,
      lumiMint: LUMI_MINT,
      config: config.publicKey,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([config])
    .rpc();

  console.log("Initialized config:", config.publicKey.toBase58());
})();
