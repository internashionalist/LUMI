import React, { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import idl from '../idl/lumi.json';
import { PROGRAM_ID, LUMI_MINT } from '../lib/solana';
import * as anchor from '@coral-xyz/anchor';
import {
	getAssociatedTokenAddressSync,
	createAssociatedTokenAccountInstruction,
	TOKEN_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// Read config pubkey from env (set NEXT_PUBLIC_CONFIG_PUBKEY in app/.env.local)
const CONFIG_PUBKEY = process.env.NEXT_PUBLIC_CONFIG_PUBKEY
	? new PublicKey(process.env.NEXT_PUBLIC_CONFIG_PUBKEY)
	: null;

// Ensure we have a PublicKey instance for PDA derivations, regardless of how PROGRAM_ID is typed.
const PROGRAM_PUBKEY =
	PROGRAM_ID instanceof PublicKey ? (PROGRAM_ID as PublicKey) : new PublicKey(PROGRAM_ID);

// LUMI has 6 decimals on Devnet
const LUMI_DECIMALS = 6;

// Atlas School Tulsa / LUMI color palette
const ATLAS = {
	navy: '#020617',
	navySoft: '#02091b',
	panel: '#020617',
	border: 'rgba(148,163,184,0.55)',
	teal: "#1fae8cff",
	tealSoft: "rgba(34,197,94,0.14)",
	tealDark: "rgba(10, 126, 85, 0.9)",
	blue: "rgba(10, 85, 135, 1)",
	cyan: "#22d3ee",
	gold: "#facc15",
	beige: "#f4dec3",
	beigeDark: "#c3a279ff",
	textPrimary: '#e5e7eb',
	textMuted: '#94a3b8',
	textSofter: '#cbd5e1',
};

// Convert a UI amount like 10 or 1.25 into base units (u64) safely using strings
function uiToBaseUnits(ui: string | number, decimals: number): anchor.BN {
	const s = String(ui).trim();
	if (!s.includes('.')) {
		return new anchor.BN(s).mul(new anchor.BN(10).pow(new anchor.BN(decimals)));
	}
	const [whole, fracRaw = ''] = s.split('.');
	const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
	const wholeBn = whole ? new anchor.BN(whole) : new anchor.BN(0);
	return wholeBn.mul(new anchor.BN(10).pow(new anchor.BN(decimals))).add(new anchor.BN(frac));
}

export default function Admin() {
	const { connection } = useConnection();
	const anchorWallet = useAnchorWallet();
	const wallet = useWallet();

	// Only render wallet UI after the component has mounted on the client
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);

	const [toAddr, setToAddr] = useState('');
	const [amount, setAmount] = useState<string>('10');
	const [reason, setReason] = useState('STTUDOR');
	const [cid, setCid] = useState('');
	const [txSig, setTxSig] = useState('');

	const issue = useCallback(async () => {
		const rawTo = toAddr.trim();
		if (!rawTo) {
			alert('Enter a recipient wallet address.');
			return;
		}
		if (rawTo.includes('...')) {
			alert(
				'Paste the full wallet address, e.g. HVn6ycq7UhYz6jGpfrgniB5hXEcBkAGfBCx3NBLbVYQw.',
			);
			return;
		}
		if (!anchorWallet?.publicKey) return;
		const issuerPk = anchorWallet.publicKey;
		if (!CONFIG_PUBKEY) throw new Error('Missing NEXT_PUBLIC_CONFIG_PUBKEY');

		try {
			const to = new PublicKey(rawTo);
			const config = CONFIG_PUBKEY;

			// PDAs: mint authority and issuer PDA (for the connected wallet)
			const [mintAuth] = PublicKey.findProgramAddressSync(
				[Buffer.from('mint_authority'), config.toBuffer()],
				PROGRAM_PUBKEY,
			);
			console.log('mintAuth PDA =', mintAuth.toBase58());
			const [issuerPda] = PublicKey.findProgramAddressSync(
				[Buffer.from('issuer'), config.toBuffer(), issuerPk.toBuffer()],
				PROGRAM_PUBKEY,
			);

			// Recipient's associated token account for LUMI
			const toAta = getAssociatedTokenAddressSync(LUMI_MINT, to, false, TOKEN_PROGRAM_ID);

			// Encode arguments to match the on-chain signature:
			// issue_lumi(ctx, amount: u64, reason_code: [u8; 8], ipfs_cid: String)
			const reasonBytes = new TextEncoder().encode(reason.padEnd(8, ' ').slice(0, 8));
			const amountBn = uiToBaseUnits(String(amount), LUMI_DECIMALS);
			const cidStr = cid ?? '';

			// Manually encode the instruction using Anchor's BorshInstructionCoder
			const ixCoder = new anchor.BorshInstructionCoder(idl as unknown as anchor.Idl);
			const data = ixCoder.encode('issue_lumi', {
				amount: amountBn,
				reason_code: Array.from(reasonBytes),
				ipfs_cid: cidStr,
			} as any);

			const tx = new Transaction();

			// If the recipient's ATA does not exist yet, create it first so the
			// on-chain program sees an initialized token account.
			const ataInfo = await connection.getAccountInfo(toAta);
			if (!ataInfo) {
				tx.add(
					createAssociatedTokenAccountInstruction(
						issuerPk, // payer (issuer wallet)
						toAta, // associated token account to create
						to, // owner of the ATA
						LUMI_MINT, // mint
						TOKEN_PROGRAM_ID,
						ASSOCIATED_TOKEN_PROGRAM_ID,
					),
				);
			}

			const keys = [
				{ pubkey: issuerPk, isSigner: true, isWritable: true }, // issuer (signer)
				{ pubkey: config, isSigner: false, isWritable: true }, // config
				{ pubkey: mintAuth, isSigner: false, isWritable: false }, // mint_authority PDA
				{ pubkey: issuerPda, isSigner: false, isWritable: true }, // issuer account PDA
				{ pubkey: to, isSigner: false, isWritable: false }, // recipient wallet
				{ pubkey: LUMI_MINT, isSigner: false, isWritable: true }, // lumi_mint
				{ pubkey: toAta, isSigner: false, isWritable: true }, // recipient ATA
				{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token program
				{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system program
				{ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // associated token program
			];

			const ix = new TransactionInstruction({
				keys,
				programId: PROGRAM_PUBKEY,
				data,
			});

			tx.add(ix);

			const sig = await wallet.sendTransaction(tx, connection);
			setTxSig(sig);
		} catch (err: any) {
			// Try to surface the real underlying wallet / RPC error for debugging
			const inner = (err && (err.error || err.cause)) || null;
			// eslint-disable-next-line no-console
			console.error('Issue LUMI failed:', err);
			if (inner) {
				// eslint-disable-next-line no-console
				console.error('Issue LUMI inner error:', inner);
			}

			let msg = err?.message || String(err);
			if (inner && inner.message && inner.message !== msg) {
				msg += ` | inner: ${inner.message}`;
			}

			alert(`Issue LUMI failed: ${msg}`);
		}
	}, [anchorWallet, connection, toAddr, amount, reason, cid, wallet]);

	return (
		<main
			style={{
				minHeight: '100vh',
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				padding: '2.5rem 1.5rem',
				background:
					'radial-gradient(circle at 0% 0%, rgba(34, 211, 238, 0.65), transparent 42%), radial-gradient(circle at 100% 100%, rgba(21, 82, 250, 0.23), transparent 45%), radial-gradient(circle at 50% -10%, rgba(56, 191, 248, 0.29), transparent 55%), #030923ff',
				color: ATLAS.textPrimary,
				fontFamily:
					'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
			}}
		>
			<div
				style={{
					width: '100%',
					maxWidth: '920px',
					padding: '1.9rem 2.1rem 2.1rem',
					borderRadius: '2px',
					border: '1px solid rgba(148,163,184,0.55)',
					background: 'linear-gradient(145deg, ATLAS.blue, ATLAS.teal)',
					boxShadow: '0 26px 70px rgba(0,0,0,0.85), 0 0 0 1px rgba(15,23,42,0.9)',
				}}
			>
				{/* Header */}
				<header
					style={{
						display: 'flex',
						flexWrap: 'wrap',
						justifyContent: 'space-between',
						alignItems: 'center',
						gap: '1.2rem',
						marginBottom: '1.75rem',
					}}
				>
					<div>
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '0.75rem',
								marginBottom: '0.35rem',
							}}
						>
							<div
								style={{
									position: 'relative',
									padding: '3px',
									borderRadius: '999px',
									background:
										'conic-gradient(from 180deg, #22c55e, #22d3ee, #facc15, #22c55e)',
								}}
							>
								<div
									style={{
										borderRadius: '999px',
										background: ATLAS.navySoft,
										padding: '0.28rem',
									}}
								>
									<img
										src="/LUMI.png"
										alt="LUMI firefly"
										style={{
											height: '2.5rem',
											width: '2.5rem',
											borderRadius: '0.9rem',
											objectFit: 'cover',
										}}
									/>
								</div>
							</div>
							<div>
								<h1
									style={{
										fontSize: '2rem',
										fontWeight: 650,
										letterSpacing: '-0.03em',
										display: 'flex',
										alignItems: 'center',
										gap: '0.4rem',
									}}
								>
									<dt style={{ color: ATLAS.cyan }}>LUMI — Admin</dt>
									<span
										style={{
											fontSize: '0.7rem',
											fontWeight: 600,
											padding: '0.18rem 0.55rem',
											borderRadius: '999px',
											background: 'rgba(34, 211, 238, 0.31)',
											color: ATLAS.gold,
											textTransform: 'uppercase',
											letterSpacing: '0.12em',
										}}
									>
										Atlas School · Tulsa
									</span>
								</h1>
								<p
									style={{
										fontSize: '0.88rem',
										color: ATLAS.beige,
										marginTop: '0.2rem',
										maxWidth: '38rem',
									}}
								>
									Issue <span style={{ color: ATLAS.cyan, fontWeight: 500 }}>LUMI</span> rewards
									directly to student wallets on Solana Devnet.
								</p>
							</div>
						</div>
					</div>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '0.5rem',
						}}
					>
						<span
							style={{
								fontSize: '0.7rem',
								color: ATLAS.gold,
								padding: '0.25rem 0.6rem',
								borderRadius: '999px',
								border: '1px solid ATLAS.gold)',
								background: 'rgba(15,23,42,0.9)',
							}}
						>
							Network:{' '}
							<span style={{ color: ATLAS.cyan, fontWeight: 500 }}>
								Devnet
							</span>
						</span>
						{mounted ? <WalletMultiButton /> : null}
					</div>
				</header>

				{/* Config warning */}
				{!CONFIG_PUBKEY && (
					<div
						style={{
							marginBottom: '1rem',
							padding: '0.8rem 1rem',
							borderRadius: '0.9rem',
							border: '1px solid rgba(248,113,113,0.6)',
							background:
								'radial-gradient(circle at 0% 0%, rgba(248,113,113,0.2), transparent 55%), rgba(30,41,59,0.96)',
							fontSize: '0.85rem',
							color: '#fee2e2',
						}}
					>
						<strong style={{ fontWeight: 600 }}>Config missing.</strong>{' '}
						Set{' '}
						<span
							style={{
								fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
								fontSize: '0.8rem',
								background: 'rgba(15,23,42,0.7)',
								padding: '0.1rem 0.35rem',
								borderRadius: '0.35rem',
							}}
						>
							NEXT_PUBLIC_CONFIG_PUBKEY
						</span>{' '}
						in{' '}
						<span
							style={{
								fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
								fontSize: '0.8rem',
							}}
						>
							app/.env.local
						</span>{' '}
						to enable issuing.
					</div>
				)}

				{/* Issue card */}
				<section
					style={{
						borderRadius: '20px',
						border: `1px solid ${ATLAS.cyan}`,
						background:
							'radial-gradient(circle at 0% 100%, rgba(34,197,94,0.12), transparent 55%), rgba(15,23,42,0.98)',
						padding: '1.15rem 1.3rem',
						marginBottom: '1.1rem',
					}}
				>
					<div
						style={{
							display: 'flex',
							justifyContent: 'space-between',
							gap: '0.75rem',
							marginBottom: '0.75rem',
						}}
					>
						<div>
							<h2
								style={{
									fontSize: '0.98rem',
									fontWeight: 600,
									marginBottom: '0.15rem',
									display: 'flex',
									alignItems: 'center',
									gap: '0.4rem',
								}}
							>
								<dt style={{ color: ATLAS.cyan }}>Issue LUMI</dt>
								<span
									style={{
										fontSize: '0.7rem',
										padding: '0.1rem 0.45rem',
										borderRadius: '999px',
										border: '1px solid rgba(148,163,184,0.7)',
										color: ATLAS.textMuted,
									}}
								>
									<dt style={{ color: ATLAS.gold }}>Admin only</dt>
								</span>
							</h2>
							<p
								style={{
									fontSize: '0.8rem',
									color: ATLAS.beige,
								}}
							>
								Enter a recipient wallet, amount, and reason code to mint new LUMI (daily cap is 100).
							</p>
						</div>
					</div>

					<div
						style={{
							display: 'grid',
							rowGap: '0.8rem',
							columnGap: '0.8rem',
							fontSize: '0.8rem',
						}}
					>
						<div>
							<label
								style={{
									display: 'block',
									fontSize: '0.8rem',
									color: ATLAS.textSofter,
									marginBottom: '0.25rem',
								}}
							>
								Recipient wallet
							</label>
							<input
								style={{
									width: '100%',
									boxSizing: 'border-box',
									borderRadius: '0.75rem',
									border: '1px solid #1e293b',
									background: ATLAS.navy,
									padding: '0.48rem 0.7rem',
									fontSize: '0.85rem',
									fontFamily:
										'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
									color: ATLAS.textPrimary,
								}}
								placeholder="Paste wallet address here"
								value={toAddr}
								onChange={(e) => setToAddr(e.target.value)}
							/>
						</div>

						<div
							style={{
								display: 'grid',
								gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
								gap: '0.8rem',
							}}
						>
							<div>
								<label
									style={{
										display: 'block',
										fontSize: '0.8rem',
										color: ATLAS.textSofter,
										marginBottom: '0.25rem',
									}}
								>
									LUMI amount (in whole numbers)
								</label>
								<input
									type="text"
									style={{
										width: '100%',
										boxSizing: 'border-box',
										borderRadius: '0.75rem',
										border: '1px solid #1e293b',
										background: ATLAS.navy,
										padding: '0.48rem 0.7rem',
										fontSize: '0.85rem',
										color: ATLAS.textPrimary,
									}}
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
									placeholder="10"
								/>
								<div
									style={{
										marginTop: '0.28rem',
										display: 'flex',
										flexWrap: 'wrap',
										gap: '0.4rem',
									}}
								>
									{['1', '5', '10', '25', '50'].map((val) => (
										<button
											key={val}
											type="button"
											onClick={() => setAmount(val)}
											style={{
												borderRadius: '999px',
												border: '1px solid rgba(148,163,184,0.6)',
												background: 'rgba(15,23,42,0.95)',
												padding: '0.18rem 0.6rem',
												fontSize: '0.75rem',
												color: ATLAS.textPrimary,
												cursor: 'pointer',
											}}
										>
											{val}
										</button>
									))}
								</div>
							</div>
							<div>
								<label
									style={{
										display: 'block',
										fontSize: '0.8rem',
										color: ATLAS.textSofter,
										marginBottom: '0.25rem',
									}}
								>
									Reason code (8 chars)
								</label>
								<input
									style={{
										width: '100%',
										boxSizing: 'border-box',
										borderRadius: '0.75rem',
										border: '1px solid #1e293b',
										background: ATLAS.navy,
										padding: '0.48rem 0.7rem',
										fontSize: '0.85rem',
										fontFamily:
											'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
										color: ATLAS.textPrimary,
									}}
									placeholder="STTUDOR"
									value={reason}
									onChange={(e) => setReason(e.target.value)}
								/>
								<p
									style={{
										fontSize: '0.72rem',
										color: ATLAS.textMuted,
										marginTop: '0.25rem',
									}}
								>
									Short tag used on-chain to describe why this award was issued.
								</p>
							</div>
						</div>

						<div
							style={{
								paddingTop: '0.25rem',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								gap: '0.75rem',
								flexWrap: 'wrap',
							}}
						>
							<button
								onClick={issue}
								disabled={!anchorWallet?.publicKey}
								style={{
									border: 'none',
									cursor: anchorWallet?.publicKey ? 'pointer' : 'not-allowed',
									opacity: anchorWallet?.publicKey ? 1 : 0.45,
									borderRadius: '999px',
									padding: '0.5rem 1.4rem',
									fontSize: '0.86rem',
									fontWeight: 600,
									background:
										'linear-gradient(135deg, #22c55e, #22d3ee, #0ea5e9)',
									color: '#020617',
									boxShadow:
										'0 0 0 1px rgba(34,197,94,0.35), 0 16px 40px rgba(34,197,94,0.25)',
									transition: 'transform 120ms ease, box-shadow 120ms ease',
								}}
							>
								Issue LUMI
							</button>
							<p
								style={{
									fontSize: '0.75rem',
									color: ATLAS.textMuted,
								}}
							>
								Connected wallet must be an authorized LUMI issuer.
							</p>
						</div>
					</div>
				</section>

				{/* Last transaction */}
				{txSig && (
					<section
						style={{
							borderRadius: '20px',
							border: '1px solid rgba(148,163,184,0.55)',
							background:
								'radial-gradient(circle at 100% 0%, rgba(56,189,248,0.16), transparent 55%), rgba(15,23,42,0.98)',
							padding: '0.9rem 1.15rem',
							fontSize: '0.8rem',
							color: ATLAS.textPrimary,
						}}
					>
						<h2
							style={{
								fontSize: '0.95rem',
								fontWeight: 600,
								marginBottom: '0.35rem',
							}}
						>
							<dt style={{ color: ATLAS.cyan }}>Last Transaction</dt>
						</h2>
						<p
							style={{
								fontSize: '0.78rem',
								marginBottom: '0.25rem',
							}}
						>
							View the most recent LUMI issuance in Solana Explorer:
						</p>
						<p style={{ wordBreak: 'break-all' }}>
							<a
								href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
								target="_blank"
								rel="noreferrer"
								style={{
									color: ATLAS.gold,
									textDecoration: 'none',
								}}
							>
								{txSig}
							</a>
						</p>
					</section>
				)}
			</div>
		</main>
	);
}
