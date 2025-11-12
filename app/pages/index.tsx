"use client";
import { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { getAssociatedTokenAddressSync, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

const RPC_ENDPOINT = process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.devnet.solana.com';
const LUMI_MINT_KEY = new PublicKey(process.env.NEXT_PUBLIC_LUMI_MINT!);
const LUMI_DECIMALS = 6;

export default function Home() {
	const { connection } = useConnection();
	const { publicKey } = useWallet();

	// Client-side hydration guard
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	// Derived ATA and formatted balance
	const [ataStr, setAtaStr] = useState<string>('');
	const [balance, setBalance] = useState<string>('-');

	// Compute ATA when wallet changes
	useEffect(() => {
		if (!publicKey) { setAtaStr(''); setBalance('0'); return; }
		try {
			const ata = getAssociatedTokenAddressSync(LUMI_MINT_KEY, publicKey, false, TOKEN_PROGRAM_ID);
			setAtaStr(ata.toBase58());
		} catch {
			setAtaStr('');
		}
	}, [publicKey]);

	// Fetch balance when ATA is known
	useEffect(() => {
		(async () => {
			if (!ataStr) { setBalance('0'); return; }
			try {
				const acc = await getAccount(connection, new PublicKey(ataStr), 'confirmed', TOKEN_PROGRAM_ID);
				const raw = BigInt(acc.amount.toString());
				const base = 10n ** BigInt(LUMI_DECIMALS);
				const whole = raw / base;
				const frac = (raw % base).toString().padStart(LUMI_DECIMALS, '0');
				setBalance(`${whole}.${frac}`);
			} catch {
				setBalance('0');
			}
		})();
	}, [ataStr, connection]);

	return (
		<main style={{ maxWidth: 720, margin: '40px auto', padding: 16 }}>
			<h1>Lumi — Student</h1>
			<div
				style={{
					background: '#e8f3ff',
					border: '1px solid #b6dbff',
					padding: '12px 16px',
					borderRadius: 8,
					margin: '12px 0',
					color: '#003366',
					fontSize: '0.9rem',
					lineHeight: 1.5,
				}}
			>
				<p><b>Network:</b> {process.env.NEXT_PUBLIC_SOLANA_RPC || 'Unknown RPC'}</p>
				<p><b>LUMI Mint:</b> {LUMI_MINT_KEY.toBase58()}</p>
				{publicKey && (
					<>
						<p><b>Wallet:</b> {publicKey.toBase58()}</p>
						<p><b>ATA:</b> {ataStr || '(no ATA yet)'}</p>
					</>
				)}
			</div>
			{mounted ? <WalletMultiButton /> : null}
			<p style={{ marginTop: 16 }}>Your LUMI balance: <b>{balance}</b></p>
			<hr />
			<h3>Recent awards</h3>
			<p>(Add signature/event history later)</p>
		</main>
	);
}
