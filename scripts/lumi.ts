import type { Idl, AnchorProvider, Program } from "@coral-xyz/anchor";
import anchorCjs from "@coral-xyz/anchor";
const anchor = anchorCjs as typeof import("@coral-xyz/anchor");
const { Wallet } = anchorCjs as any;
const BN = (anchorCjs as any).BN ?? (anchor as any).BN;
if (typeof BN !== "function") {
  throw new Error("Anchor BN not found: ensure @coral-xyz/anchor is installed and ESM interop is set. Try adding \"type\": \"module\" in package.json or running with --esm.");
}
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

import fs from "fs";
import path from "path";

// SPL token (legacy) by default - can be overridden via TOKEN_PROGRAM env var
const TOKEN_PROGRAM_TO_USE = new PublicKey(
  process.env.TOKEN_PROGRAM || "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

const LUMI_MINT = new PublicKey(
	process.env.LUMI_MINT || process.env.LUMI_MINT_PUBKEY || "3S8K81Fg4aiifjhGmPhEzm56nA7LeooUUe5SokNoABwz"
);
if (process.argv.includes("--init") || process.env.DO_INIT === "1") {
	console.log("Using LUMI_MINT:", LUMI_MINT.toBase58());
}

function loadIdl(): Idl {
  const idlPath = path.resolve(process.cwd(), "target/idl/lumi.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(
      `IDL not found at ${idlPath}.\n` +
      `Run: anchor idl fetch 3YSZsaAoTtJHhHp43vq1WwJxKDQKsTWsTfhX86KER5Vg -o target/idl/lumi.json\n` +
      `If you recently redeployed, make sure this ID matches the on-chain program and your Anchor.toml.`
    );
  }
  const raw = fs.readFileSync(idlPath, "utf8");
  return JSON.parse(raw);
}

// 6 decimals - can be changed to mint more per day
const DAILY_CAP_PER_ISSUER = new BN(1_000_000_000);

const CONFIG_PATH = path.resolve(process.cwd(), "target/config.json");

function saveConfigPubkey(pubkey: PublicKey) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ config: pubkey.toBase58() }, null, 2),
    "utf8"
  );
  console.log("Saved config pubkey to", CONFIG_PATH);
}

function loadConfigPubkey(): PublicKey | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (j?.config) return new PublicKey(j.config);
  } catch {}
  return null;
}

export const PROGRAM_ID = new PublicKey(
  "DkVEJV8J2biu2jUBibqUHAzvupfP1XSMMXuARNAe2piM"
);

function getProvider(): AnchorProvider {
  const url =
    process.env.ANCHOR_PROVIDER_URL ||
    process.env.SOLANA_URL ||
    "https://api.devnet.solana.com";

  const defaultWallet = path.resolve(
    process.env.HOME || process.env.USERPROFILE || ".",
    ".config/solana/id.json"
  );
  const walletPath = process.env.ANCHOR_WALLET || defaultWallet;

  if (!fs.existsSync(walletPath)) {
    throw new Error(
      `Wallet file not found at ${walletPath}. Set ANCHOR_WALLET or create one with "solana-keygen new".`
    );
  }

  const secret = JSON.parse(fs.readFileSync(walletPath, "utf8"));
  const kp = Keypair.fromSecretKey(Uint8Array.from(secret));

  const connection = new Connection(url, "confirmed");
  const wallet = new Wallet(kp);

  return new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

function idlHasAccount(idl: any, name: string): boolean {
  return Array.isArray(idl?.accounts) && idl.accounts.some((a: any) => a?.name === name && a?.type?.kind === "struct");
}

// removes invalid account layouts from the IDL - make fetch go fast
function sanitizeIdl(idl: any): { sanitized: any; keptNames: string[] } {
  const clone = JSON.parse(JSON.stringify(idl));
  const rawNames = Array.isArray(idl?.accounts)
    ? idl.accounts.map((a: any) => a?.name).filter(Boolean)
    : [];

  const keptAccounts = Array.isArray(idl?.accounts)
    ? idl.accounts.filter(
        (a: any) =>
          a &&
          a.type &&
          a.type.kind === "struct" &&
          Array.isArray(a.type.fields)
      )
    : [];

  const keptNames = keptAccounts.map((a: any) => a?.name).filter(Boolean);

  if (clone) {
    clone.accounts = keptAccounts;
  }

  console.log("IDL accounts (raw):", rawNames);
  console.log("IDL accounts (kept):", keptNames);
  if (keptAccounts.length === 0) {
    console.warn(
      "Warning: No valid accounts left in IDL after sanitation. Typed account helpers will be unavailable; script will skip typed fetch."
    );
  }

  return { sanitized: clone, keptNames };
}

async function main() {
  const idl = loadIdl();
  const { sanitized: sanitizedIdl, keptNames } = sanitizeIdl(idl);

  // log to show what instructions are available
  const ixNames: string[] = Array.isArray((idl as any)?.instructions)
    ? (idl as any).instructions.map((i: any) => i?.name).filter(Boolean)
    : [];
  console.log("IDL instructions:", ixNames);

  // for --init flag
  const wantInit = process.argv.includes("--init") || process.env.DO_INIT === "1";

  const provider = getProvider();
  anchor.setProvider(provider);

  if (!idl?.accounts || !Array.isArray(idl.accounts) || idl.accounts.length === 0) {
    console.warn(
      "Note: IDL has no account layouts. Ensure your Rust structs are annotated with #[account] and visible to the IDL, then rebuild and re-fetch the IDL (e.g. `anchor build && anchor idl fetch",
      PROGRAM_ID.toBase58(),
      "-o target/idl/lumi.json`)."
    );
  }

  const ProgramCtor: any = (anchor as any).Program;
  let program: Program;
  try {
    program = new ProgramCtor(sanitizedIdl as Idl, PROGRAM_ID, provider);

	// sanity check: ensure programId matches
	if (program?.programId?.toBase58?.() !== PROGRAM_ID.toBase58()) {
      throw new Error("Program ctor order mismatch; retrying");
    }
  } catch (_e) {
    program = new ProgramCtor(sanitizedIdl as Idl, provider, PROGRAM_ID);
  }


  console.log("wallet:", provider.wallet.publicKey.toBase58());
  console.log("program:", PROGRAM_ID.toBase58());

  // load saved config or instruct to run --init
  let configPubkey = loadConfigPubkey();
  if (configPubkey) {
    console.log("config (saved):", configPubkey.toBase58());
  } else {
    console.log("No saved config. Run with --init to create the Config account.");
  }

  async function initializeConfig(program: Program, walletPubkey: PublicKey) {
	// generate new config keypair
	const configKp = Keypair.generate();
    const cfg = configKp.publicKey;

    // mint_authority PDA = ["mint_authority", config.key()]
    const [mintAuthorityPda, mintAuthBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_authority"), cfg.toBuffer()],
      PROGRAM_ID
    );

    // sanity check: ensure LUMI_MINT exists and is owned by the selected TOKEN_PROGRAM
    const connection = (anchor.getProvider() as any).connection;
    const mintInfo = await connection.getAccountInfo(LUMI_MINT);
    if (!mintInfo) {
      throw new Error("LUMI_MINT not found on-chain. Create the mint first (Token-2022 by default).");
    }
    console.log("LUMI_MINT owner:", mintInfo.owner.toBase58());
    if (!mintInfo.owner.equals(TOKEN_PROGRAM_TO_USE)) {
      throw new Error(
        `Selected token program (${TOKEN_PROGRAM_TO_USE.toBase58()}) does not match LUMI_MINT owner (${mintInfo.owner.toBase58()}). ` +
        `Set TOKEN_PROGRAM to Tokenkeg… for SPL Token or to Tokenz… for Token-2022, or recreate the mint under the desired program.`
      );
    }

    console.log("Creating new Config at:", cfg.toBase58());
    console.log("mint_authority PDA:", mintAuthorityPda.toBase58(), "bump:", mintAuthBump);

    // tries regular Anchor .rpc() path first
    try {
      const ixBuilder =
        (program.methods as any).initializeConfig ||
        (program.methods as any).initialize_config;
      if (typeof ixBuilder !== "function") {
        throw new Error("IDL missing initialize_config / initializeConfig in program.methods");
      }

      console.log("Using token program:", TOKEN_PROGRAM_TO_USE.toBase58());
      const txSig = await ixBuilder(DAILY_CAP_PER_ISSUER)
	  	  // both cases to make life easier
          .accounts({
          admin: walletPubkey,
          mintAuthority: mintAuthorityPda,
          mint_authority: mintAuthorityPda,
          lumiMint: LUMI_MINT,
          lumi_mint: LUMI_MINT,
          config: cfg,
          systemProgram: anchor.web3.SystemProgram.programId,
          system_program: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_TO_USE,
          token_program: TOKEN_PROGRAM_TO_USE,
        })
        .signers([configKp])
        .rpc();

      console.log("initialize_config tx:", txSig);
      saveConfigPubkey(cfg);
      return cfg;
    } catch (e: any) {
      console.warn("Anchor .rpc() path failed, falling back to manual instruction:", e?.message || e);
    }
	// manual instruction encoding
    function instructionDiscriminator(name: string): Buffer {
      const seed = `global:${name}`;
      const digest = Buffer.from(sha256(Buffer.from(seed)));
      return digest.subarray(0, 8);
    }

    const disc = instructionDiscriminator("initialize_config");

	// helper to encode u64 LE
    function bnToLeU64(x: any): Buffer {
      const b = Buffer.alloc(8);
      const n = BigInt(x.toString());
      b.writeBigUInt64LE(n);
      return b;
    }

    const data = Buffer.concat([disc, bnToLeU64(DAILY_CAP_PER_ISSUER)]);

    const keys = [
      { pubkey: walletPubkey, isSigner: true, isWritable: true },
      { pubkey: mintAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: LUMI_MINT, isSigner: false, isWritable: true },
      { pubkey: cfg, isSigner: true, isWritable: true },
      { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_TO_USE, isSigner: false, isWritable: false },
    ];

    const ix = new anchor.web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys,
      data,
    });

    const tx = new anchor.web3.Transaction().add(ix);
    tx.feePayer = walletPubkey;
    const { blockhash } = await (anchor.getProvider() as any).connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;
    tx.partialSign(configKp);
    const sig = await (anchor.getProvider() as any).sendAndConfirm(tx, [configKp]);
    console.log("initialize_config (manual) tx:", sig);

    saveConfigPubkey(cfg);
    return cfg;
  }

  async function addIssuer(program: Program, walletPubkey: PublicKey, configPubkey: PublicKey) {
    const [issuerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("issuer"), configPubkey.toBuffer(), walletPubkey.toBuffer()],
      PROGRAM_ID
    );
  
    function instructionDiscriminator(name: string): Buffer {
      const seed = `global:${name}`;
      const digest = Buffer.from(sha256(Buffer.from(seed)));
      return digest.subarray(0, 8);
    }
    const disc = instructionDiscriminator("add_issuer");
  
    const data = Buffer.from(disc);
  
    const keys = [
      { pubkey: walletPubkey, isSigner: true, isWritable: true },          // admin
      { pubkey: configPubkey, isSigner: false, isWritable: true },         // config (mut)
      { pubkey: issuerPda, isSigner: false, isWritable: true },            // issuer (init PDA)
      { pubkey: walletPubkey, isSigner: false, isWritable: false },        // issuer_wallet (unchecked)
      { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ];
  
    const ix = new anchor.web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys,
      data,
    });
  
    const tx = new anchor.web3.Transaction().add(ix);
    tx.feePayer = walletPubkey;
    const { blockhash } = await (anchor.getProvider() as any).connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;
  
    const sig = await (anchor.getProvider() as any).sendAndConfirm(tx, []);
    console.log("add_issuer (manual) tx:", sig);
    console.log("issuer PDA:", issuerPda.toBase58());
    return issuerPda;
  }

  // helpers for issueLumi
  function ixDisc(name: string): Buffer {
    const seed = `global:${name}`;
    return Buffer.from(sha256(Buffer.from(seed))).subarray(0, 8);
  }
  function u64Le(n: bigint): Buffer {
    const b = Buffer.alloc(8);
    let v = n;
    for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
    return b;
  }
  function borshString(str: string): Buffer {
    const bytes = Buffer.from(str, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(bytes.length, 0);
    return Buffer.concat([len, bytes]);
  }
  function parseAmountToU64(amountInput: string, decimals: number, baseUnits: boolean): bigint {
    const POW10 = (d: number) => (10n ** BigInt(d));

    if (baseUnits) {
      if (!/^\d+$/.test(amountInput)) {
        throw new Error("--base-units expects an integer amount (raw u64 base units)");
      }
      return BigInt(amountInput);
    }

    if (/^\d+$/.test(amountInput)) {
      // plain integers are whole units
      return BigInt(amountInput) * POW10(decimals);
    }

	// decimal number
    const [whole, fracRaw = ""] = amountInput.split(".");
    if (!/^\d+$/.test(whole || "0") || !/^\d*$/.test(fracRaw)) {
      throw new Error("Amount must be an integer or decimal number, e.g. 5 or 1.25");
    }
    const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
    return (BigInt(whole || "0") * POW10(decimals)) + BigInt(frac || "0");
  }

  async function issueLumi(
    program: Program,
    connection: Connection,
    configPubkey: PublicKey,
    toPubkey: PublicKey,
    amountInput: string,
    reasonHex?: string,
    cid?: string,
    baseUnits: boolean = false
  ) {

    const [issuerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("issuer"), configPubkey.toBuffer(), (anchor.getProvider() as any).wallet.publicKey.toBuffer()],
      PROGRAM_ID
    );
    const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_authority"), configPubkey.toBuffer()],
      PROGRAM_ID
    );

    const tokenAccts = await connection.getTokenAccountsByOwner(toPubkey, {
      mint: LUMI_MINT,
      programId: TOKEN_PROGRAM_TO_USE
    });
    if (!tokenAccts.value.length) {
      throw new Error(
        `No ATA for recipient ${toPubkey.toBase58()} and mint ${LUMI_MINT.toBase58()} under program ${TOKEN_PROGRAM_TO_USE.toBase58()}.\n` +
        `Create one first:\n  spl-token create-account ${LUMI_MINT.toBase58()} --owner ${toPubkey.toBase58()}`
      );
    }
    const toAta = tokenAccts.value[0].pubkey;

    const parsedMint = await connection.getParsedAccountInfo(LUMI_MINT);
    const decimals = (parsedMint.value as any)?.data?.parsed?.info?.decimals;
    if (typeof decimals !== "number") {
      throw new Error("Unable to read mint decimals from chain");
    }
    const amountU64 = parseAmountToU64(amountInput, decimals, baseUnits);

    const disc = ixDisc("issue_lumi");
    const amountBuf = u64Le(amountU64);
    const reason = (reasonHex ?? "0000000000000000").toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{16}$/.test(reason)) {
      throw new Error("reason must be 8-byte hex (16 hex chars), e.g. 0000000000000000");
    }
    const reasonBuf = Buffer.from(reason, "hex");
    const cidBuf = borshString(cid ?? "");
    const data = Buffer.concat([disc, amountBuf, reasonBuf, cidBuf]);

    const keys = [
      { pubkey: (anchor.getProvider() as any).wallet.publicKey, isSigner: true,  isWritable: true  }, // wallet
      { pubkey: configPubkey,               isSigner: false, isWritable: true  }, // config
      { pubkey: mintAuthorityPda,           isSigner: false, isWritable: false }, // mint_authority
      { pubkey: issuerPda,                  isSigner: false, isWritable: true  }, // issuer
      { pubkey: toPubkey,                   isSigner: false, isWritable: false }, // to (unchecked)
      { pubkey: LUMI_MINT,                  isSigner: false, isWritable: true  }, // lumi_mint (mut)
      { pubkey: toAta,                      isSigner: false, isWritable: true  }, // to_ata (mut)
      { pubkey: TOKEN_PROGRAM_TO_USE,       isSigner: false, isWritable: false }, // token_program
    ];

    const ix = new anchor.web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys,
      data,
    });
    const tx = new anchor.web3.Transaction().add(ix);
    tx.feePayer = (anchor.getProvider() as any).wallet.publicKey;
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;

    const sig = await (anchor.getProvider() as any).sendAndConfirm(tx, []);
    console.log("issue_lumi (manual) tx:", sig);
    console.log("to ATA:", toAta.toBase58(), "amount (u64):", amountU64.toString());
  }

  // helpers: balance lookup for a given owner
  async function balanceForOwner(
    connection: Connection,
    owner: PublicKey
  ) {
    const parsed = await connection.getParsedTokenAccountsByOwner(owner, {
      mint: LUMI_MINT,
      programId: TOKEN_PROGRAM_TO_USE,
    });

    if (!parsed.value.length) {
      console.log("No token accounts found for owner with this mint.");
      return;
    }

    let sumRaw = 0n;
    let decimals = 0;

    for (const { account, pubkey } of parsed.value) {
      const info: any = account.data.parsed.info;
      decimals = info.tokenAmount.decimals;
      const amt = BigInt(info.tokenAmount.amount);
      sumRaw += amt;

      console.log(
        "ATA:",
        pubkey.toBase58(),
        "amount (raw):",
        info.tokenAmount.amount,
        "uiAmount:",
        info.tokenAmount.uiAmountString
      );
    }

    const pow10 = 10n ** BigInt(decimals);
    const whole = sumRaw / pow10;
    const frac = (sumRaw % pow10).toString().padStart(decimals, "0");
    console.log("TOTAL:", `${whole}.${frac}`.replace(/\.$/, ""), "(raw:", sumRaw.toString() + ")");
  }

  if (wantInit) {
    try {
      configPubkey = await initializeConfig(program, provider.wallet.publicKey);
    } catch (e: any) {
      console.warn("Initializer failed:", e?.message || e);
    }
  }

  // create issuer PDA for the current wallet
  if (process.argv.includes("--add-issuer")) {
    if (!configPubkey) {
      throw new Error("No config pubkey. Run with --init first to create Config.");
    }
    await addIssuer(program, provider.wallet.publicKey, configPubkey);
  }

  // --issue handler: before typed/raw Config fetch logic
  if (process.argv.includes("--issue")) {
    const idx = process.argv.indexOf("--issue");
    const toArg = process.argv[idx + 1];
    const amtArg = process.argv[idx + 2];
    if (!toArg || !amtArg) {
      throw new Error("Usage: --issue <recipient_pubkey> <amount> [--reason 8hex] [--cid <string>] [--base-units]");
    }
    const toPubkey = new PublicKey(toArg);

    let reasonHex: string | undefined;
    let cid: string | undefined;
    const rIdx = process.argv.indexOf("--reason");
    if (rIdx !== -1 && process.argv[rIdx + 1]) reasonHex = process.argv[rIdx + 1];
    const cIdx = process.argv.indexOf("--cid");
    if (cIdx !== -1 && process.argv[cIdx + 1]) cid = process.argv[cIdx + 1];

    const saved = loadConfigPubkey();
    if (!saved) throw new Error("No config saved. Run --init first.");
    const configPubkey = saved;

    const baseUnits = process.argv.includes("--base-units");
    const connection = (anchor.getProvider() as any).connection;
    await issueLumi(program, connection, configPubkey, toPubkey, amtArg, reasonHex, cid, baseUnits);
    return;
  }

  // --balance handler
  if (process.argv.includes("--balance")) {
    const idx = process.argv.indexOf("--balance");
    const ownerArg = process.argv[idx + 1];
    if (!ownerArg) {
      throw new Error("Usage: --balance <owner_pubkey>");
    }
    const owner = new PublicKey(ownerArg);
    const connection = (anchor.getProvider() as any).connection;
    await balanceForOwner(connection, owner);
    return;
  }

  // typed vs raw Config fetch
  const hasConfig = keptNames.includes("Config");

  if (configPubkey) {
    if (hasConfig) {
      try {
        // @ts-ignore - typed fetch
        const cfg = await program.account.config.fetch(configPubkey);
        console.log("Typed Config:", cfg);
      } catch (e: any) {
        console.warn("Typed fetch failed:", e?.message || e);
      }
    } else {
      console.warn(
        "IDL has no 'Config' account layout; skipping typed helpers. Falling back to raw getAccountInfo."
      );
      try {
        const info = await provider.connection.getAccountInfo(configPubkey);
        if (info) {
          console.log("Config account exists (raw): data length =", info.data.length);
        } else {
          console.log("Config account not found on-chain.");
        }
      } catch (e: any) {
        console.warn("Raw getAccountInfo failed:", e?.message || e);
      }
    }
  } else {
    console.log("No config pubkey available. Run with --init first.");
  }

  if (configPubkey) {
    const [issuerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("issuer"), configPubkey.toBuffer(), provider.wallet.publicKey.toBuffer()],
      PROGRAM_ID
    );
    console.log("issuer PDA (example):", issuerPda.toBase58());
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});