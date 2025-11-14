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

const ATLAS = {
	navy: "#020617",
	navySoft: "#02091b",
	panel: "#020617",
	border: "rgba(148,163,184,0.55)",
	teal: "#1fae8cff",
	tealSoft: "rgba(34,197,94,0.14)",
	tealDark: "rgba(10, 126, 85, 0.9)",
	cyan: "#22d3ee",
	gold: "#facc15",
	blue: "rgba(0, 183, 255, 0.96)",
	beige: "#f4dec3",
	beigeDark: "#e8c9a4",
	textPrimary: "#e5e7eb",
	textMuted: "#94a3b8",
	textSofter: "#cbd5e1",
};

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

	const fullWallet = useMemo(() => {
		if (!publicKey) return null;
		return publicKey.toBase58();
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
						toAta, // ATA to create
						to, // ATA owner
						LUMI_MINT, // mint
						TOKEN_PROGRAM_ID,
						ASSOCIATED_TOKEN_PROGRAM_ID,
					),
				);
			}

			const keys = [
				{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // issuer
				{ pubkey: config, isSigner: false, isWritable: true }, // config
				{ pubkey: mintAuth, isSigner: false, isWritable: false }, // mint_authority PDA
				{ pubkey: issuerPda, isSigner: false, isWritable: true }, // issuer_pda
				{ pubkey: to, isSigner: false, isWritable: false }, // recipient wallet
				{ pubkey: LUMI_MINT, isSigner: false, isWritable: true }, // lumi_mint
				{ pubkey: toAta, isSigner: false, isWritable: true }, // to_ata
				{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
				{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
				{
					pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
					isSigner: false,
					isWritable: false,
				}, // associated_token_program
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
				padding: "2.5rem 1.5rem",
				background: `radial-gradient(circle at 0% 0%, ${ATLAS.beige}, transparent 52%), linear-gradient(145deg, ${ATLAS.beige}, ${ATLAS.teal})`,
				fontFamily:
					'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
			}}
		>
			<div
				style={{
					width: "100%",
					maxWidth: "920px",
					padding: "1.9rem 2.1rem 2.1rem",
					borderRadius: "28px",
					border: "1px solid rgba(148,163,184,0.55)",
					background: ATLAS.beige,
					boxShadow:
						"0 26px 70px rgba(0,0,0,0.85), 0 0 0 1px rgba(15,23,42,0.9)",
				}}
			>
				{/* Header */}
				<header
					style={{
						display: "flex",
						flexWrap: "wrap",
						justifyContent: "space-between",
						alignItems: "center",
						gap: "1.2rem",
						marginBottom: "1.75rem",
					}}
				>
					<div>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "0.75rem",
								marginBottom: "0.35rem",
							}}
						>
							<div
								style={{
									position: "relative",
									padding: "3px",
									borderRadius: "999px",
									background:
										"conic-gradient(from 180deg, #22c55e, #22d3ee, #facc15, #22c55e)",
								}}
							>
								<div
									style={{
										borderRadius: "999px",
										background: ATLAS.tealSoft,
										padding: "0.28rem",
									}}
								>
									<img
										src="/LUMI.png"
										alt="LUMI firefly"
										style={{
											height: "2.5rem",
											width: "2.5rem",
											borderRadius: "0.9rem",
											objectFit: "cover",
										}}
									/>
								</div>
							</div>
							<div>
								<h1
									style={{
										fontSize: "2rem",
										fontWeight: 650,
										letterSpacing: "-0.03em",
										display: "flex",
										alignItems: "center",
										gap: "0.4rem",
									}}
								>
									<span style={{ color: "rgba(10, 85, 135, 1)" }}>LUMI Dashboard</span>
									<span
										style={{
											fontSize: "0.7rem",
											fontWeight: 600,
											padding: "0.18rem 0.55rem",
											borderRadius: "999px",
											background: "linear-gradient(135deg, #22c55e, #22d3ee, #0ea5e9)",
											color: ATLAS.navySoft,
											textTransform: "uppercase",
											letterSpacing: "0.12em",
										}}
									>
										Atlas School · Tulsa
									</span>
								</h1>
								<p
									style={{
										fontSize: "0.88rem",
										color: ATLAS.teal,
										marginTop: "0.2rem",
										maxWidth: "36rem",
									}}
								>
									Devnet-only Solana SPL token for{" "}
									<span style={{ color: ATLAS.tealDark }}>Atlas School</span> rewards
									and achievements.
								</p>
							</div>
						</div>
					</div>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "0.5rem",
						}}
					>
						<span
							style={{
								fontSize: "0.7rem",
								color: ATLAS.navy,
								padding: "0.25rem 0.6rem",
								borderRadius: "999px",
								border: "1px solid rgba(148,163,184,0.4)",
								background: "linear-gradient(135deg, #22c55e, #22d3ee, #0ea5e9)",
							}}
						>
							Network:{" "}
							<span style={{ color: ATLAS.navySoft, fontWeight: 500 }}>
								Devnet
							</span>
						</span>
						{mounted ? <WalletMultiButton /> : null}
					</div>
				</header>

				{/* Cards row */}
				<section
					style={{
						display: "grid",
						gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)",
						gap: "1.25rem",
						marginBottom: "1.3rem",
					}}
				>
					{/* Token & Network */}
					<div
						style={{
							borderRadius: "20px",
							border: `1px solid ${ATLAS.border}`,
							background:
								"radial-gradient(circle at 0% 0%, rgba(70, 71, 131, 0.80), rgba(19, 181, 124, 0.98))",
							padding: "1.05rem 1.25rem",
							fontSize: "0.8rem",
							color: ATLAS.textPrimary,
						}}
					>
						<h2
							style={{
								fontSize: "0.95rem",
								fontWeight: 600,
								marginBottom: "0.55rem",
								display: "flex",
								alignItems: "center",
								gap: "0.45rem",
							}}
						>
							<span
								style={{
									height: "1.6rem",
									width: "1.6rem",
									borderRadius: "999px",
									background: ATLAS.teal,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									fontSize: "0.86rem",
									color: ATLAS.gold,
								}}
							>
								◎
							</span>
							<span style={{ color: ATLAS.gold }}>Token &amp; Network</span>
						</h2>
						<dl style={{ margin: 0 }}>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									gap: "0.75rem",
									marginBottom: "0.25rem",
								}}
							>
								<span style={{ color: ATLAS.beige }}>Network</span>
								<dd
									style={{
										margin: 0,
										maxWidth: "60%",
										textAlign: "right",
										color: ATLAS.cyan,
									}}
								>
									<span style={{ color: ATLAS.cyan }}>Solana Devnet</span>
								</dd>
							</div>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									gap: "0.75rem",
									marginBottom: "0.25rem",
								}}
							>
								<dt style={{ color: ATLAS.beige }}>RPC</dt>
								<dd
									style={{
										margin: 0,
										maxWidth: "60%",
										textAlign: "right",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										color: ATLAS.cyan,
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
									marginBottom: "0.25rem",
								}}
							>
								<span style={{ color: ATLAS.beige }}>LUMI Mint</span>
								<dd
									style={{
										margin: 0,
										maxWidth: "60%",
										textAlign: "right",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										color: ATLAS.beige,
									}}
								>
									<span style={{ color: ATLAS.cyan }}>{LUMI_MINT.toBase58()}</span>
								</dd>
							</div>
						</dl>
						<div
							style={{
								display: "flex",
								flexWrap: "wrap",
								gap: "0.9rem",
								marginTop: "0.75rem",
							}}
						>
							<a
								href={`https://explorer.solana.com/address/${LUMI_MINT.toBase58()}?cluster=devnet`}
								target="_blank"
								rel="noreferrer"
								style={{
									fontSize: "0.86rem",
									color: ATLAS.blue,
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
									fontSize: "0.86rem",
									color: ATLAS.blue,
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
							borderRadius: "20px",
							border: `1px solid ${ATLAS.border}`,
							background:
								"radial-gradient(circle at 0% 0%, rgba(70, 71, 131, 0.80), rgba(19, 181, 124, 0.98))",
							padding: "1.05rem 1.25rem",
							fontSize: "0.8rem",
						}}
					>
						<h2
							style={{
								fontSize: "0.95rem",
								fontWeight: 600,
								marginBottom: "0.55rem",
								display: "flex",
								alignItems: "center",
								gap: "0.4rem",
							}}
						>
							<span
								style={{
									height: "1.6rem",
									width: "1.6rem",
									borderRadius: "999px",
									background: ATLAS.teal,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									fontSize: "0.8rem",
									color: ATLAS.gold,
								}}
							>
								✦
							</span>
							<dt style={{ color: ATLAS.gold }}>Wallet &amp; LUMI Balance</dt>
						</h2>
						<div style={{ fontSize: "0.86rem" }}>
							{connected && publicKey ? (
								<>
									<p style={{ color: ATLAS.beige, marginBottom: "0.25rem" }}>
										Connected Wallet:{" "}
										<span
											style={{
												fontFamily:
													'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
												color: ATLAS.cyan,
											}}
										>
											{fullWallet}
										</span>
									</p>
									<p style={{ color: ATLAS.beige, marginBottom: "0.25rem" }}>
										LUMI Balance:{" "}
										<span
											style={{
												fontFamily:
													'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
												color: ATLAS.cyan,
											}}
										>
											{balance}
										</span>
									</p>
									<p
										style={{
											color: ATLAS.textMuted,
											fontSize: "0.86rem",
											marginBottom: "0.2rem",
										}}
									>
										<dt style={{ color: ATLAS.beige }}>Associated Token Account:</dt>
									</p>
									<p
										style={{
											fontSize: "0.76rem",
											fontFamily:
												'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
											color: ATLAS.cyan,
											wordBreak: "break-all",
										}}
									>
										{ataStr || "(no ATA yet)"}
									</p>
								</>
							) : (
								<>
									<p style={{ color: "#e2e8f0", marginBottom: "0.25rem" }}>
										No wallet connected. Use the button above to connect a
										wallet.
									</p>
									<p
										style={{
											color: ATLAS.cyan,
											fontSize: "0.76rem",
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
									marginTop: "0.9rem",
									display: "flex",
									flexDirection: "column",
									gap: "0.4rem",
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
										opacity: mounted && !claiming ? 1 : 0.65,
										borderRadius: "999px",
										padding: "0.5rem 1.2rem",
										fontSize: "0.86rem",
										fontWeight: 600,
										background:
											"linear-gradient(135deg, #22c55e, #22d3ee, #0ea5e9)",
										color: "#020617",
										boxShadow:
											"0 0 0 1px rgba(34,197,94,0.35), 0 16px 40px rgba(34,197,94,0.25)",
										alignSelf: "flex-start",
										transition: "transform 120ms ease, box-shadow 120ms ease",
									}}
								>
									{claiming ? "Claiming 1 LUMI..." : "Claim 1 LUMI"}
								</button>
								{claimError && (
									<p
										style={{
											fontSize: "0.76rem",
											color: "#fecaca",
										}}
									>
										{claimError}
									</p>
								)}
								{claimTx && !claimError && (
									<p
										style={{
											fontSize: "0.76rem",
											color: "#bae6fd",
										}}
									>
										Last claim:{" "}
										<a
											href={`https://explorer.solana.com/tx/${claimTx}?cluster=devnet`}
											target="_blank"
											rel="noreferrer"
											style={{
												color: ATLAS.cyan,
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
								marginTop: "0.75rem",
								padding: "0.5rem 0.7rem",
								borderRadius: "0.95rem",
								border: "1px solid rgba(30,64,175,0.8)",
								background:
									"radial-gradient(circle at 0% 0%, rgba(19, 181, 124, 0.98), rgba(70, 71, 131, 0.80))",
							}}
						>
							<p
								style={{
									fontSize: "0.75rem",
									color: ATLAS.beige,
								}}
							>
								View your LUMI balance using{" "}
								<strong>Solflare</strong> on Devnet.
							</p>
						</div>
					</div>
				</section>

				{/* Recent awards */}
				<section
					style={{
						borderRadius: "20px",
						border: "1px dashed rgba(148,163,184,0.7)",
						background:
							"radial-gradient(circle at 0% 0%, rgba(70, 71, 131, 0.80), rgba(19, 181, 124, 0.98))",
						padding: "1rem 1.2rem",
						fontSize: "0.8rem",
						color: ATLAS.gold,
					}}
				>
					<h2
						style={{
							fontSize: "0.95rem",
							fontWeight: 600,
							marginBottom: "0.45rem",
							display: "flex",
							alignItems: "center",
							gap: "0.45rem",
						}}
					>
						<span
							style={{
								height: "1.6rem",
								width: "1.6rem",
								borderRadius: "999px",
								background: ATLAS.teal,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								fontSize: "0.8rem",
								color: ATLAS.gold,
							}}
						>
							★
						</span>
						Recent awards
					</h2>
					<p style={{ fontSize: "0.78rem", color: ATLAS.beigeDark }}>
						Until I wire in awards, use{" "}
						<span style={{ color: ATLAS.cyan }}>Solscan</span> or{" "}
						<span style={{ color: ATLAS.cyan }}>Solana Explorer</span> to view
						recent transactions.
					</p>
				</section>
			</div>
		</main>
	);
}
