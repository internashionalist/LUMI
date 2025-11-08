import type { AppProps } from 'next/app';
import '../styles/globals.css';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import '@solana/wallet-adapter-react-ui/styles.css';

export default function MyApp({ Component, pageProps }: AppProps) {
  const endpoint = 'https://api.devnet.solana.com';
  const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

  return (
	<ConnectionProvider endpoint={endpoint}>
	  <WalletProvider wallets={wallets} autoConnect>
		<WalletModalProvider>
		  <Component {...pageProps} />
		</WalletModalProvider>
	  </WalletProvider>
	</ConnectionProvider>
  );
}
