import { Connection, PublicKey } from "@solana/web3.js";

export interface PositionSnapshot {
  protocol: string;
  positionValueCents: number;
  collateralRatioBps: number;
  liquidationThresholdBps: number;
  lastUpdated: number;
}

/**
 * Fetches position data from DeFi protocols on Solana.
 * In production, this integrates with Kamino, MarginFi, Jupiter, etc.
 * For the hackathon demo, uses simulated data with realistic values.
 */
export async function fetchPositionData(
  connection: Connection,
  walletAddress: PublicKey
): Promise<PositionSnapshot[]> {
  const positions: PositionSnapshot[] = [];

  // Fetch real SOL balance as a baseline
  const balance = await connection.getBalance(walletAddress);
  const solBalance = balance / 1e9;

  if (solBalance > 0) {
    // Simulate a lending position on Kamino
    positions.push({
      protocol: "Kamino Lending",
      positionValueCents: Math.floor(solBalance * 150 * 100), // SOL price ~$150
      collateralRatioBps: 14500, // 145% collateral
      liquidationThresholdBps: 11000, // 110% threshold
      lastUpdated: Date.now(),
    });

    // Simulate a MarginFi borrow position
    positions.push({
      protocol: "MarginFi",
      positionValueCents: Math.floor(solBalance * 75 * 100), // Half position
      collateralRatioBps: 12000, // 120% - closer to danger
      liquidationThresholdBps: 11000,
      lastUpdated: Date.now(),
    });
  }

  // Simulate a Jupiter LP position
  positions.push({
    protocol: "Jupiter LP (SOL/USDC)",
    positionValueCents: 250000, // $2,500
    collateralRatioBps: 20000, // 200% (healthy LP)
    liquidationThresholdBps: 10500,
    lastUpdated: Date.now(),
  });

  return positions;
}

/**
 * Fetches oracle price data from Pyth Network.
 * Returns prices in USD cents.
 */
export async function fetchOraclePrices(): Promise<Record<string, number>> {
  // In production, use @pythnetwork/price-service-client
  // For demo, return realistic prices
  return {
    SOL: 15000,   // $150.00
    USDC: 100,    // $1.00
    ETH: 350000,  // $3,500.00
    BTC: 9500000, // $95,000.00
  };
}
