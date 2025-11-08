import { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { getAssociatedTokenAddressSync, getAccount, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { LUMI_MINT } from '../lib/solana';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export default function Home() {
	const { connection } = useConnection();
	const { publicKey } = useWallet();
	const [balance, setBalance] = useState<string>('-');

	useEffect(() => {
		(async () => {
			if (!publicKey) return;
			try {
				const ata = getAssociatedTokenAddressSync(LUMI_MINT, publicKey, false, TOKEN_2022_PROGRAM_ID);
				const acc = await getAccount(connection, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
				setBalance(acc.amount.toString());
			} catch (_) {
				setBalance('0');
			}
		})();
	}, [publicKey, connection]);

	return (
		<main style={{ maxWidth: 720, margin: '40px auto', padding: 16 }}>
			<h1>Lumi — Student</h1>
			<WalletMultiButton />
			<p style={{ marginTop: 16 }}>Your LUMI balance: <b>{balance}</b></p>
			<hr />
			<h3>Recent awards</h3>
			<p>(Add signature/event history later)</p>
		</main>
	);
}
