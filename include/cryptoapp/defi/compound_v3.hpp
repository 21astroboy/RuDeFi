// compound_v3.hpp - Scan Compound III (Comet) supply positions.
//
// Compound V3 deploys one Comet contract per market (USDC market on Arbitrum,
// WETH market on Ethereum, etc.). User's supply balance equals
// `Comet.balanceOf(account)`; debt is `Comet.borrowBalanceOf(account)`.
// Both auto-include accrued interest.
#pragma once

#include "cryptoapp/chain/chain_config.hpp"
#include "cryptoapp/chain/rpc_client.hpp"
#include "cryptoapp/defi/defi_types.hpp"

#include <vector>

namespace cryptoapp::defi {

[[nodiscard]] std::vector<DefiPosition>
scan_compound_v3(chain::RpcClient& rpc,
                 const chain::ChainConfig& cfg,
                 const chain::Address& wallet);

}  // namespace cryptoapp::defi
