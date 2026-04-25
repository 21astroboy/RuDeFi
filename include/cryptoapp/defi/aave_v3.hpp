// aave_v3.hpp - Scan a wallet's Aave V3 lending positions.
//
// One eth_call per chain to Pool.getUserAccountData(user) returns the entire
// account summary in USD (Aave's internal oracle uses BASE_CURRENCY = USD * 1e8).
#pragma once

#include "cryptoapp/chain/chain_config.hpp"
#include "cryptoapp/chain/rpc_client.hpp"
#include "cryptoapp/defi/defi_types.hpp"

#include <vector>

namespace cryptoapp::defi {

// Returns 0..N positions for this chain. Empty if Aave isn't deployed there
// (config has zero address) or the wallet has no exposure.
[[nodiscard]] std::vector<DefiPosition>
scan_aave_v3(chain::RpcClient& rpc,
             const chain::ChainConfig& cfg,
             const chain::Address& wallet);

// Spark Lend uses Aave V3's exact ABI on a different pool address. Fork-aware
// shared scanner for Aave-style lending markets.
[[nodiscard]] std::vector<DefiPosition>
scan_aave_like(chain::RpcClient& rpc,
               const chain::ChainConfig& cfg,
               const chain::Address& wallet,
               const chain::Address& pool_address,
               const std::string& protocol_label);

}  // namespace cryptoapp::defi
