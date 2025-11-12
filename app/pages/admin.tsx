import { useCallback, useMemo, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import idl from '../../target/idl/lumi.json';
import { PROGRAM_ID, LUMI_MINT } from '../lib/solana';
import * as anchor from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Read config pubkey from env (set NEXT_PUBLIC_CONFIG_PUBKEY in app/.env.local)
const CONFIG_PUBKEY = process.env.NEXT_PUBLIC_CONFIG_PUBKEY
  ? new PublicKey(process.env.NEXT_PUBLIC_CONFIG_PUBKEY)
  : null;

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
	const wallet = useWallet();

	const [toAddr, setToAddr] = useState('');
	const [amount, setAmount] = useState<string>('10');
	const [reason, setReason] = useState('REVWHELP');
	const [cid, setCid] = useState('');
	const [txSig, setTxSig] = useState('');

	const provider = useMemo(() => new anchor.AnchorProvider(connection, wallet as any, {}), [connection, wallet]);
	const program = useMemo(() => new anchor.Program(idl as any, PROGRAM_ID, provider), [provider]);

	const issue = useCallback(async () => {
		if (!wallet.publicKey) return;
		const to = new PublicKey(toAddr);
		if (!CONFIG_PUBKEY) throw new Error('Missing NEXT_PUBLIC_CONFIG_PUBKEY');
		const config = CONFIG_PUBKEY;
		const [mintAuth] = PublicKey.findProgramAddressSync([Buffer.from('mint_authority'), config.toBuffer()], PROGRAM_ID);
		const toAta = getAssociatedTokenAddressSync(LUMI_MINT, to, false, TOKEN_PROGRAM_ID);

		const reasonBytes = new TextEncoder().encode(reason.padEnd(8, ' ').slice(0, 8));

		const tx = await program.methods
			.issueLumi(uiToBaseUnits(String(amount), LUMI_DECIMALS), Array.from(reasonBytes) as any, cid)
			.accounts({
				issuerWallet: wallet.publicKey,
				config,
				mintAuthority: mintAuth,
				issuer: PublicKey.findProgramAddressSync([Buffer.from('issuer'), config.toBuffer(), wallet.publicKey.toBuffer()], PROGRAM_ID)[0],
				to,
				lumiMint: LUMI_MINT,
				toAta,
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.transaction();

		const sig = await wallet.sendTransaction(tx, connection);
		await connection.confirmTransaction(sig, 'confirmed');
		setTxSig(sig);
	}, [wallet, connection, program, toAddr, amount, reason, cid]);

	return (
		<main style={{ maxWidth: 720, margin: '40px auto', padding: 16 }}>
			<h1>Lumi — Admin (Issuer)</h1>
			{!CONFIG_PUBKEY && (
				<p style={{color: 'crimson'}}>
					Missing NEXT_PUBLIC_CONFIG_PUBKEY in app/.env.local — cannot issue.
				</p>
			)}
			<WalletMultiButton />
			<div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
				<input placeholder="Recipient wallet" value={toAddr} onChange={e => setToAddr(e.target.value)} />
				<input type="text" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (e.g., 1 or 0.5)" />
				<input placeholder="Reason code (8 chars)" value={reason} onChange={e => setReason(e.target.value)} />
				<input placeholder="IPFS CID (optional)" value={cid} onChange={e => setCid(e.target.value)} />
				<button onClick={issue} disabled={!wallet.publicKey}>Issue LUMI</button>
			</div>
			{txSig && <p>Last tx: <a href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`} target="_blank" rel="noreferrer">{txSig}</a></p>}
		</main>
	);
}
