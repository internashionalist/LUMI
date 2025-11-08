import { useCallback, useMemo, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import idl from '../../target/idl/lumi.json';
import { PROGRAM_ID, LUMI_MINT } from '../lib/solana';
import * as anchor from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

export default function Admin() {
	const { connection } = useConnection();
	const wallet = useWallet();

	const [toAddr, setToAddr] = useState('');
	const [amount, setAmount] = useState(50);
	const [reason, setReason] = useState('REVWHELP');
	const [cid, setCid] = useState('');
	const [txSig, setTxSig] = useState('');

	const provider = useMemo(() => new anchor.AnchorProvider(connection, wallet as any, {}), [connection, wallet]);
	const program = useMemo(() => new anchor.Program(idl as any, PROGRAM_ID, provider), [provider]);

	const issue = useCallback(async () => {
		if (!wallet.publicKey) return;
		const to = new PublicKey(toAddr);

		const [config] = PublicKey.findProgramAddressSync([Buffer.from('config'), PROGRAM_ID.toBuffer()], PROGRAM_ID);
		const [mintAuth] = PublicKey.findProgramAddressSync([Buffer.from('mint_authority'), config.toBuffer()], PROGRAM_ID);
		const toAta = getAssociatedTokenAddressSync(LUMI_MINT, to, false, TOKEN_2022_PROGRAM_ID);

		const reasonBytes = new TextEncoder().encode(reason.padEnd(8, ' ').slice(0, 8));

		const tx = await program.methods
			.issueLumi(new anchor.BN(amount), Array.from(reasonBytes) as any, cid)
			.accounts({
				issuerWallet: wallet.publicKey,
				config,
				mintAuthority: mintAuth,
				issuer: PublicKey.findProgramAddressSync([Buffer.from('issuer'), config.toBuffer(), wallet.publicKey.toBuffer()], PROGRAM_ID)[0],
				to,
				lumiMint: LUMI_MINT,
				toAta,
				tokenProgram: TOKEN_2022_PROGRAM_ID,
			})
			.transaction();

		const sig = await wallet.sendTransaction(tx, connection);
		await connection.confirmTransaction(sig, 'confirmed');
		setTxSig(sig);
	}, [wallet, connection, program, toAddr, amount, reason, cid]);

	return (
		<main style={{ maxWidth: 720, margin: '40px auto', padding: 16 }}>
			<h1>Lumi — Admin (Issuer)</h1>
			<WalletMultiButton />
			<div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
				<input placeholder="Recipient wallet" value={toAddr} onChange={e => setToAddr(e.target.value)} />
				<input type="number" value={amount} onChange={e => setAmount(parseInt(e.target.value || '0'))} />
				<input placeholder="Reason code (8 chars)" value={reason} onChange={e => setReason(e.target.value)} />
				<input placeholder="IPFS CID (optional)" value={cid} onChange={e => setCid(e.target.value)} />
				<button onClick={issue} disabled={!wallet.publicKey}>Issue LUMI</button>
			</div>
			{txSig && <p>Last tx: <a href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`} target="_blank" rel="noreferrer">{txSig}</a></p>}
		</main>
	);
}
