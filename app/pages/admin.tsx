import React, { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet, useAnchorWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import idl from '../idl/lumi.json';
import { PROGRAM_ID, LUMI_MINT } from '../lib/solana';
import * as anchor from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Read config pubkey from env (set NEXT_PUBLIC_CONFIG_PUBKEY in app/.env.local)
const CONFIG_PUBKEY = process.env.NEXT_PUBLIC_CONFIG_PUBKEY
  ? new PublicKey(process.env.NEXT_PUBLIC_CONFIG_PUBKEY)
  : null;

// Ensure we have a PublicKey instance for PDA derivations, regardless of how PROGRAM_ID is typed.
const PROGRAM_PUBKEY =
  PROGRAM_ID instanceof PublicKey ? (PROGRAM_ID as PublicKey) : new PublicKey(PROGRAM_ID);

// LUMI has 6 decimals on Devnet
const LUMI_DECIMALS = 6;


// Convert a UI amount like 10 or 1.25 into base units (u64) safely using strings
function uiToBaseUnits(ui: string | number, decimals: number): anchor.BN {
  const s = String(ui).trim();
  if (!s.includes(".")) {
    return new anchor.BN(s).mul(new anchor.BN(10).pow(new anchor.BN(decimals)));
  }
  const [whole, fracRaw = ""] = s.split(".");
  const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
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
      alert('Paste the full wallet address (no ellipsis), e.g. HVn6ycq7UhYz6jGpfrgniB5hXEcBkAGfBCx3NBLbVYQw.');
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
				PROGRAM_PUBKEY
			);
			console.log('mintAuth PDA =', mintAuth.toBase58());
			const [issuerPda] = PublicKey.findProgramAddressSync(
				[Buffer.from('issuer'), config.toBuffer(), issuerPk.toBuffer()],
				PROGRAM_PUBKEY
			);

			// Recipient's associated token account for LUMI
			const toAta = getAssociatedTokenAddressSync(
				LUMI_MINT,
				to,
				false,
				TOKEN_PROGRAM_ID
			);

			// Encode arguments to match the on-chain signature:
			// issue_lumi(ctx, amount: u64, reason_code: [u8; 8], ipfs_cid: String)
			const reasonBytes = new TextEncoder().encode(
				reason.padEnd(8, ' ').slice(0, 8)
			);
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
            issuerPk,      // payer (issuer wallet)
            toAta,         // associated token account to create
            to,            // owner of the ATA
            LUMI_MINT,     // mint
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        );
      }

      const keys = [
        { pubkey: issuerPk, isSigner: true, isWritable: true }, // issuer (signer)
        { pubkey: config, isSigner: false, isWritable: true },   // config
        { pubkey: mintAuth, isSigner: false, isWritable: false }, // mint_authority PDA
        { pubkey: issuerPda, isSigner: false, isWritable: true }, // issuer account PDA
        { pubkey: to, isSigner: false, isWritable: false },       // recipient wallet
        { pubkey: LUMI_MINT, isSigner: false, isWritable: true }, // lumi_mint
        { pubkey: toAta, isSigner: false, isWritable: true },     // recipient ATA
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

			alert(
				`Issue LUMI failed: ${msg}`,
			);
		}
	}, [anchorWallet, connection, toAddr, amount, reason, cid, wallet, PROGRAM_PUBKEY]);

	return (
		<main
			style={{
				minHeight: '100vh',
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				padding: '2rem',
				background:
					'radial-gradient(circle at top, #020617 0, #020617 25%, #0f172a 55%, #020617 100%)',
				color: '#e5e7eb',
				fontFamily:
					'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
			}}
		>
			<div
				style={{
					width: '100%',
					maxWidth: '720px',
					padding: '1.75rem 2rem',
					borderRadius: '24px',
					border: '1px solid rgba(148,163,184,0.5)',
					background: 'rgba(15,23,42,0.96)',
					boxShadow: '0 24px 60px rgba(0,0,0,0.75)',
				}}
			>
				<header
					style={{
						display: 'flex',
						flexWrap: 'wrap',
						justifyContent: 'space-between',
						alignItems: 'center',
						gap: '1rem',
						marginBottom: '1.5rem',
					}}
				>
					<div>
						<div
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '0.6rem',
								marginBottom: '0.25rem',
							}}
						>
							<img
								src="/LUMI.png"
								alt="LUMI firefly"
								style={{
									height: '2.5rem',
									width: '2.5rem',
									borderRadius: '0.9rem',
									border: '1px solid rgba(45,212,191,0.7)',
									boxShadow: '0 10px 25px rgba(0,0,0,0.7)',
									objectFit: 'cover',
									backgroundColor: '#020617',
								}}
							/>
							<h1
								style={{
									fontSize: '1.8rem',
									fontWeight: 600,
									letterSpacing: '-0.03em',
								}}
							>
								LUMI — Admin (Issuer)
							</h1>
						</div>
						<p
							style={{
								fontSize: '0.9rem',
								color: '#cbd5f5',
								maxWidth: '35rem',
							}}
						>
							Issue LUMI to student wallets on Solana devnet.
						</p>
					</div>
					<div>
						{mounted ? <WalletMultiButton /> : null}
					</div>
				</header>

				{!CONFIG_PUBKEY && (
					<div
						style={{
							marginBottom: '1rem',
							padding: '0.75rem 1rem',
							borderRadius: '0.9rem',
							border: '1px solid rgba(248,113,113,0.5)',
							background: 'rgba(248,113,113,0.16)',
							fontSize: '0.85rem',
							color: '#fee2e2',
						}}
					>
						<strong style={{ fontWeight: 600 }}>Config missing.</strong>{' '}
						Set{' '}
						<span
							style={{
								fontFamily:
									'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
								fontSize: '0.8rem',
								background: 'rgba(15,23,42,0.7)',
								padding: '0.1rem 0.3rem',
								borderRadius: '0.35rem',
							}}
						>
							NEXT_PUBLIC_CONFIG_PUBKEY
						</span>{' '}
						in{' '}
						<span
							style={{
								fontFamily:
									'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
								fontSize: '0.8rem',
							}}
						>
							app/.env.local
						</span>{' '}
						to enable issuing.
					</div>
				)}

				<section
					style={{
						borderRadius: '18px',
						border: '1px solid rgba(148,163,184,0.55)',
						background: 'rgba(15,23,42,0.96)',
						padding: '1.1rem 1.25rem',
						marginBottom: '1.1rem',
					}}
				>
					<h2
						style={{
							fontSize: '0.95rem',
							fontWeight: 600,
							marginBottom: '0.75rem',
						}}
					>
						Issue LUMI
					</h2>
					<div
						style={{
							display: 'grid',
							rowGap: '0.75rem',
							columnGap: '0.75rem',
						}}
					>
						<div>
							<label
								style={{
									display: 'block',
									fontSize: '0.8rem',
									color: '#cbd5e1',
									marginBottom: '0.25rem',
								}}
							>
								Recipient wallet
							</label>
							<input
								style={{
									width: '100%',
									borderRadius: '0.7rem',
									border: '1px solid #1e293b',
									background: '#020617',
									padding: '0.45rem 0.65rem',
									fontSize: '0.85rem',
									fontFamily:
										'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
									color: '#e5e7eb',
								}}
								placeholder="HVn6ycq7UhYz6jGpfrgniB5hXEcBkAGfBCx3NBLbVYQw"
								value={toAddr}
								onChange={(e) => setToAddr(e.target.value)}
							/>
						</div>

						<div
							style={{
								display: 'grid',
								gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
								gap: '0.75rem',
							}}
						>
							<div>
								<label
									style={{
										display: 'block',
										fontSize: '0.8rem',
										color: '#cbd5e1',
										marginBottom: '0.25rem',
									}}
								>
									Amount (LUMI)
								</label>
								<input
									type="text"
									style={{
										width: '100%',
										borderRadius: '0.7rem',
										border: '1px solid #1e293b',
										background: '#020617',
										padding: '0.45rem 0.65rem',
										fontSize: '0.85rem',
										color: '#e5e7eb',
									}}
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
									placeholder="10"
								/>
								<div
									style={{
										marginTop: '0.25rem',
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
												padding: '0.2rem 0.6rem',
												fontSize: '0.75rem',
												color: '#e5e7eb',
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
										color: '#cbd5e1',
										marginBottom: '0.25rem',
									}}
								>
									Reason code (8 chars)
								</label>
								<input
									style={{
										width: '100%',
										borderRadius: '0.7rem',
										border: '1px solid #1e293b',
										background: '#020617',
										padding: '0.45rem 0.65rem',
										fontSize: '0.85rem',
										fontFamily:
											'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
										color: '#e5e7eb',
									}}
									placeholder="STTUDOR"
									value={reason}
									onChange={(e) => setReason(e.target.value)}
								/>
							</div>
						</div>

						<div>
							<label
								style={{
									display: 'block',
									fontSize: '0.8rem',
									color: '#cbd5e1',
									marginBottom: '0.25rem',
								}}
							>
								IPFS CID (optional)
							</label>
							<input
								style={{
									width: '100%',
									borderRadius: '0.7rem',
									border: '1px solid #1e293b',
									background: '#020617',
									padding: '0.45rem 0.65rem',
									fontSize: '0.85rem',
									fontFamily:
										'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
									color: '#e5e7eb',
								}}
								placeholder="bafybeigs6yytp..."
								value={cid}
								onChange={(e) => setCid(e.target.value)}
							/>
						</div>

						<div style={{ paddingTop: '0.25rem' }}>
							<button
								onClick={issue}
								disabled={!anchorWallet?.publicKey}
								style={{
									border: 'none',
									cursor: anchorWallet?.publicKey ? 'pointer' : 'not-allowed',
									opacity: anchorWallet?.publicKey ? 1 : 0.45,
									borderRadius: '0.7rem',
									padding: '0.5rem 1.25rem',
									fontSize: '0.85rem',
									fontWeight: 600,
									background:
										'linear-gradient(to right, #22c55e, #14b8a6)',
									color: '#020617',
									boxShadow: '0 0 0 1px rgba(34,197,94,0.35)',
								}}
							>
								Issue LUMI
							</button>
						</div>
					</div>
				</section>

				{txSig && (
					<section
						style={{
							borderRadius: '18px',
							border: '1px solid rgba(148,163,184,0.55)',
							background: 'rgba(15,23,42,0.96)',
							padding: '0.9rem 1.1rem',
							fontSize: '0.8rem',
							color: '#e5e7eb',
						}}
					>
						<h2
							style={{
								fontSize: '0.95rem',
								fontWeight: 600,
								marginBottom: '0.35rem',
							}}
						>
							Last transaction
						</h2>
						<p style={{ wordBreak: 'break-all' }}>
							<a
								href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
								target="_blank"
								rel="noreferrer"
								style={{
									color: '#6ee7b7',
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
