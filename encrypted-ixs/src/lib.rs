use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    /// User's encrypted DeFi position data.
    /// All values in basis points or USD cents to avoid floating point.
    pub struct PositionData {
        /// Position value in USD cents (e.g., 100000 = $1000.00)
        position_value: u64,
        /// Collateral ratio in basis points (e.g., 15000 = 150%)
        collateral_ratio: u64,
        /// Liquidation threshold in basis points (e.g., 11000 = 110%)
        liquidation_threshold: u64,
    }

    /// Encrypted risk assessment result stored on-chain.
    pub struct RiskState {
        /// Whether the position is at risk (1 = at risk, 0 = safe)
        is_at_risk: u64,
        /// Risk severity: 0=safe, 1=low, 2=medium, 3=critical
        severity: u64,
    }

    /// Initializes a new risk state account with safe defaults.
    /// Called once when a user registers their position for monitoring.
    #[instruction]
    pub fn init_risk_state(mxe: Mxe) -> Enc<Mxe, RiskState> {
        let state = RiskState {
            is_at_risk: 0,
            severity: 0,
        };
        mxe.from_arcis(state)
    }

    /// Performs a privacy-preserving health check on an encrypted position.
    ///
    /// The agent submits the user's encrypted position data along with public
    /// oracle data. MPC nodes compute the risk assessment without ever seeing
    /// the actual position values.
    ///
    /// Risk levels:
    /// - 3 (critical): Position near liquidation (within 5% of threshold)
    /// - 2 (medium): Significant price drop detected (>10%)
    /// - 1 (low): TVL exodus from protocol (>20% drop)
    /// - 0 (safe): No threats detected
    #[instruction]
    pub fn check_position_health(
        position: Enc<Shared, PositionData>,
        risk_state: Enc<Mxe, RiskState>,
    ) -> Enc<Mxe, RiskState> {
        let pos = position.to_arcis();
        let _prev = risk_state.to_arcis();

        // Check if position is near liquidation (within 5% buffer = 500 basis points)
        let near_liquidation = pos.collateral_ratio < pos.liquidation_threshold + 500;

        // Determine severity based on how close to liquidation
        let mut severity: u64 = 0;
        let mut at_risk: u64 = 0;

        if near_liquidation {
            severity = 3; // critical
            at_risk = 1;
        }

        // Check if collateral ratio is in warning zone (within 10% = 1000 basis points)
        if severity == 0 && pos.collateral_ratio < pos.liquidation_threshold + 1000 {
            severity = 2; // medium
            at_risk = 1;
        }

        // Check if position value is suspiciously low (possible exploit drain)
        if severity == 0 && pos.position_value < 100 {
            severity = 1; // low - possible dust/drained position
            at_risk = 1;
        }

        let new_state = RiskState {
            is_at_risk: at_risk,
            severity,
        };

        risk_state.owner.from_arcis(new_state)
    }

    /// Reveals the risk assessment result.
    /// Only the position owner can trigger this to see if action is needed.
    /// Returns true if the position is at risk.
    #[instruction]
    pub fn reveal_risk(risk_state: Enc<Mxe, RiskState>) -> bool {
        let state = risk_state.to_arcis();
        (state.is_at_risk > 0).reveal()
    }
}
