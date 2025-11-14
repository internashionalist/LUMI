"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import idl from "../idl/lumi.json";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PROGRAM_ID, LUMI_MINT } from "../lib/solana";


const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
const LUMI_DECIMALS = 6;

// Simple helper: convert a UI amount string to base units BN
function toBaseUnits(uiAmount: string, decimals: number): anchor.BN {
  const [whole, frac = ""] = uiAmount.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+/, "") || "0";
  return new anchor.BN(combined);
}

const CONFIG_PUBKEY = process.env.NEXT_PUBLIC_CONFIG_PUBKEY
  ? new PublicKey(process.env.NEXT_PUBLIC_CONFIG_PUBKEY)
  : null;

const PROGRAM_PUBKEY =
  PROGRAM_ID instanceof PublicKey
    ? (PROGRAM_ID as PublicKey)
    : new PublicKey(PROGRAM_ID as any);

export default function Home() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, connected } = wallet;

  // Client-side hydration guard for wallet button
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Derived ATA and formatted balance
  const [ataStr, setAtaStr] = useState<string>("");
  const [balance, setBalance] = useState<string>("-");

  const [claiming, setClaiming] = useState(false);
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Shortened wallet for display
  const shortWallet = useMemo(() => {
    if (!publicKey) return null;
    const s = publicKey.toBase58();
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  }, [publicKey]);

  // Compute ATA when wallet changes
  useEffect(() => {
    if (!publicKey) {
      setAtaStr("");
      setBalance("0");
      return;
    }
    try {
      const ata = getAssociatedTokenAddressSync(
        LUMI_MINT,
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
      );
      setAtaStr(ata.toBase58());
    } catch {
      setAtaStr("");
    }
  }, [publicKey]);

  // Fetch balance when ATA is known
  useEffect(() => {
    (async () => {
      if (!ataStr) {
        setBalance("0");
        return;
      }
      try {
        const acc = await getAccount(
          connection,
          new PublicKey(ataStr),
          "confirmed",
          TOKEN_PROGRAM_ID,
        );
        const raw = BigInt(acc.amount.toString());
        const base = 10n ** BigInt(LUMI_DECIMALS);
        const whole = raw / base;
        const frac = (raw % base).toString().padStart(LUMI_DECIMALS, "0");
        setBalance(`${whole}.${frac}`);
      } catch {
        setBalance("0");
      }
    })();
  }, [ataStr, connection]);

  const claim = useCallback(async () => {
    if (!wallet.publicKey) return;
    if (!CONFIG_PUBKEY) {
      setClaimError("Config account not set for this environment.");
      return;
    }

    setClaimError(null);
    setClaiming(true);

    try {
      const config = CONFIG_PUBKEY;
      const to = wallet.publicKey;

      const [mintAuth] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint_authority"), config.toBuffer()],
        PROGRAM_PUBKEY,
      );
      const [issuerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("issuer"), config.toBuffer(), wallet.publicKey.toBuffer()],
        PROGRAM_PUBKEY,
      );

      const toAta = getAssociatedTokenAddressSync(
        LUMI_MINT,
        to,
        false,
        TOKEN_PROGRAM_ID,
      );

      // Mirror the admin issuer logic: 1 LUMI in UI => base units BN
      const amountBn = toBaseUnits("1", LUMI_DECIMALS);
      const reasonBytes = new TextEncoder().encode("CLAIMDEV".slice(0, 8));
      const cid = "";

      // Manually encode the instruction using Anchor's BorshInstructionCoder
      const ixCoder = new anchor.BorshInstructionCoder(
        idl as unknown as anchor.Idl,
      );
      const data = ixCoder.encode("issue_lumi", {
        amount: amountBn,
        reason_code: Array.from(reasonBytes),
        ipfs_cid: cid,
      } as any);

      const tx = new Transaction();

      // Ensure the recipient's ATA exists; if not, create it before calling the program.
      const ataInfo = await connection.getAccountInfo(toAta);
      if (!ataInfo) {
        tx.add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey, // payer
            toAta,            // ATA to create
            to,               // ATA owner
            LUMI_MINT,        // mint
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        );
      }

      const keys = [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // issuer
        { pubkey: config, isSigner: false, isWritable: true },          // config
        { pubkey: mintAuth, isSigner: false, isWritable: false },       // mint_authority PDA
        { pubkey: issuerPda, isSigner: false, isWritable: true },       // issuer_pda
        { pubkey: to, isSigner: false, isWritable: false },             // recipient wallet
        { pubkey: LUMI_MINT, isSigner: false, isWritable: true },       // lumi_mint
        { pubkey: toAta, isSigner: false, isWritable: true },           // to_ata
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },          // token_program
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },   // system_program
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // associated_token_program
      ];

      const ix = new TransactionInstruction({
        keys,
        programId: PROGRAM_PUBKEY,
        data,
      });

      tx.add(ix);

      const sig = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setClaimTx(sig);
    } catch (e: any) {
      console.error(e);
      setClaimError(e?.message ?? "Claim failed");
    } finally {
      setClaiming(false);
    }
  }, [wallet, connection]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "2rem",
        background:
          "radial-gradient(circle at top, #020617 0, #020617 25%, #0f172a 55%, #020617 100%)",
        color: "#e5e7eb",
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "880px",
          padding: "1.75rem 2rem",
          borderRadius: "24px",
          border: "1px solid rgba(148,163,184,0.5)",
          background: "rgba(15,23,42,0.96)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.75)",
        }}
      >
        {/* Header */}
        <header
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                marginBottom: "0.25rem",
              }}
            >
              <img
                src="/LUMI.png"
                alt="LUMI firefly"
                style={{
                  height: "2.5rem",
                  width: "2.5rem",
                  borderRadius: "0.9rem",
                  border: "1px solid rgba(45,212,191,0.7)",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.7)",
                  objectFit: "cover",
                  backgroundColor: "#020617",
                }}
              />
              <h1
                style={{
                  fontSize: "1.9rem",
                  fontWeight: 600,
                  letterSpacing: "-0.03em",
                }}
              >
                LUMI Dashboard
              </h1>
            </div>
            <p
              style={{
                fontSize: "0.9rem",
                color: "#cbd5f5",
                maxWidth: "35rem",
              }}
            >
              SPL token for Atlas School rewards and achievements on Solana
			  Devnet
            </p>
          </div>
          <div>{mounted ? <WalletMultiButton /> : null}</div>
        </header>

        {/* Cards row */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: "1rem",
            marginBottom: "1.1rem",
          }}
        >
          {/* Token & Network */}
          <div
            style={{
              borderRadius: "18px",
              border: "1px solid rgba(148,163,184,0.55)",
              background: "rgba(15,23,42,0.96)",
              padding: "1rem 1.2rem",
              fontSize: "0.8rem",
            }}
          >
            <h2
              style={{
                fontSize: "0.95rem",
                fontWeight: 600,
                marginBottom: "0.5rem",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <span
                style={{
                  height: "1.5rem",
                  width: "1.5rem",
                  borderRadius: "999px",
                  background: "rgba(45,212,191,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.7rem",
                  color: "#6ee7b7",
                }}
              >
                ◎
              </span>
              Token &amp; Network
            </h2>
            <dl style={{ margin: 0 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  marginBottom: "0.15rem",
                }}
              >
                <dt style={{ color: "#cbd5e1" }}>Network</dt>
                <dd
                  style={{
                    margin: 0,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                  }}
                >
                  Solana Devnet
                </dd>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  marginBottom: "0.15rem",
                }}
              >
                <dt style={{ color: "#cbd5e1" }}>RPC</dt>
                <dd
                  style={{
                    margin: 0,
                    maxWidth: "60%",
                    textAlign: "right",
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {RPC_ENDPOINT}
                </dd>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  marginBottom: "0.15rem",
                }}
              >
                <dt style={{ color: "#cbd5e1" }}>LUMI Mint</dt>
                <dd
                  style={{
                    margin: 0,
                    maxWidth: "60%",
                    textAlign: "right",
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {LUMI_MINT.toBase58()}
                </dd>
              </div>
            </dl>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.75rem",
                marginTop: "0.6rem",
              }}
            >
              <a
                href={`https://explorer.solana.com/address/${LUMI_MINT.toBase58()}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: "0.7rem",
                  color: "#6ee7b7",
                  textDecoration: "none",
                }}
              >
                View mint on Explorer →
              </a>
              <a
                href={`https://solscan.io/token/${LUMI_MINT.toBase58()}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: "0.7rem",
                  color: "#7dd3fc",
                  textDecoration: "none",
                }}
              >
                View on Solscan →
              </a>
            </div>
          </div>

          {/* Wallet & LUMI Balance */}
          <div
            style={{
              borderRadius: "18px",
              border: "1px solid rgba(148,163,184,0.55)",
              background: "rgba(15,23,42,0.96)",
              padding: "1rem 1.2rem",
              fontSize: "0.8rem",
            }}
          >
            <h2
              style={{
                fontSize: "0.95rem",
                fontWeight: 600,
                marginBottom: "0.5rem",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <span
                style={{
                  height: "1.5rem",
                  width: "1.5rem",
                  borderRadius: "999px",
                  background: "rgba(56,189,248,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.7rem",
                  color: "#7dd3fc",
                }}
              >
                ₿
              </span>
              Wallet &amp; LUMI Balance
            </h2>
            <div style={{ fontSize: "0.85rem" }}>
              {connected && publicKey ? (
                <>
                  <p style={{ color: "#e2e8f0", marginBottom: "0.25rem" }}>
                    Connected wallet:{" "}
                    <span
                      style={{
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                        color: "#6ee7b7",
                      }}
                    >
                      {shortWallet}
                    </span>
                  </p>
                  <p style={{ color: "#e2e8f0", marginBottom: "0.25rem" }}>
                    LUMI balance:{" "}
                    <span
                      style={{
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                        color: "#6ee7b7",
                      }}
                    >
                      {balance}
                    </span>
                  </p>
                  <p
                    style={{
                      color: "#94a3b8",
                      fontSize: "0.75rem",
                      marginBottom: "0.15rem",
                    }}
                  >
                    Associated token account:
                  </p>
                  <p
                    style={{
                      fontSize: "0.72rem",
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                      color: "#cbd5e1",
                      wordBreak: "break-all",
                    }}
                  >
                    {ataStr || "(no ATA yet)"}
                  </p>
                </>
              ) : (
                <>
                  <p style={{ color: "#e2e8f0", marginBottom: "0.25rem" }}>
                    No wallet connected. Use the button above to connect a wallet.
                  </p>
                  <p
                    style={{
                      color: "#94a3b8",
                      fontSize: "0.75rem",
                    }}
                  >
                    Make sure your wallet is set to{" "}
                    <span style={{ fontWeight: 600 }}>Solana Devnet</span>.
                  </p>
                </>
              )}
            </div>
            {connected && publicKey && (
              <div
                style={{
                  marginTop: "0.75rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.35rem",
                }}
              >
                <button
                  type="button"
                  onClick={claim}
                  disabled={!mounted || claiming}
                  style={{
                    border: "none",
                    cursor:
                      mounted && !claiming ? "pointer" : "not-allowed",
                    opacity: mounted && !claiming ? 1 : 0.5,
                    borderRadius: "0.7rem",
                    padding: "0.45rem 1.1rem",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    background:
                      "linear-gradient(to right, #22c55e, #14b8a6)",
                    color: "#020617",
                    boxShadow: "0 0 0 1px rgba(34,197,94,0.35)",
                    alignSelf: "flex-start",
                  }}
                >
                  {claiming ? "Claiming 1 LUMI..." : "Claim 1 LUMI"}
                </button>
                {claimError && (
                  <p
                    style={{
                      fontSize: "0.75rem",
                      color: "#fecaca",
                    }}
                  >
                    {claimError}
                  </p>
                )}
                {claimTx && !claimError && (
                  <p
                    style={{
                      fontSize: "0.75rem",
                      color: "#bae6fd",
                    }}
                  >
                    Last claim:{" "}
                    <a
                      href={`https://explorer.solana.com/tx/${claimTx}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        color: "#7dd3fc",
                        textDecoration: "none",
                      }}
                    >
                      view on Explorer →
                    </a>
                  </p>
                )}
              </div>
            )}
            <div
              style={{
                marginTop: "0.55rem",
                padding: "0.45rem 0.6rem",
                borderRadius: "0.9rem",
                border: "1px solid #1e293b",
                background: "rgba(2,6,23,0.9)",
              }}
            >
              <p
                style={{
                  fontSize: "0.72rem",
                  color: "#e5e7eb",
                }}
              >
                To view balances, use <strong>Solflare</strong> on Devnet.
              </p>
            </div>
          </div>
        </section>

        {/* Recent awards */}
        <section
          style={{
            borderRadius: "18px",
            border: "1px dashed rgba(148,163,184,0.6)",
            background: "rgba(15,23,42,0.96)",
            padding: "0.9rem 1.1rem",
            fontSize: "0.8rem",
            color: "#e5e7eb",
          }}
        >
          <h2
            style={{
              fontSize: "0.95rem",
              fontWeight: 600,
              marginBottom: "0.35rem",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <span
              style={{
                height: "1.5rem",
                width: "1.5rem",
                borderRadius: "999px",
                background: "rgba(251,191,36,0.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.7rem",
                color: "#fde68a",
              }}
            >
              ✦
            </span>
            Recent awards
          </h2>
          <p style={{ fontSize: "0.78rem", color: "#cbd5e1" }}>
            This panel will list the most recent LUMI awards once on-chain
            history is wired up. For now, use Solscan or Solana Explorer to
            view transactions involving the LUMI mint and your wallet.
          </p>
        </section>
      </div>
    </main>
  );
}
