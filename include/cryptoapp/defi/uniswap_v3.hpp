// uniswap_v3.hpp - Scan a wallet's Uniswap V3 NFT liquidity positions.
//
// Uniswap V3 positions are NFTs minted by NonfungiblePositionManager.
// We list them via ERC721Enumerable and read each position struct.
//
// MVP scope (this file): show one row per position with token pair, fee tier,
// tick range, raw liquidity, and an in-range flag. Precise USD valuation
// (TickMath + sqrt-price math) is planned for a follow-up.
#pragma once

#include "cryptoapp/chain/chain_config.hpp"
#include "cryptoapp/chain/rpc_client.hpp"
#include "cryptoapp/defi/defi_types.hpp"

#include <vector>

namespace cryptoapp::defi {

[[nodiscard]] std::vector<DefiPosition>
scan_uniswap_v3(chain::RpcClient& rpc,
                const chain::ChainConfig& cfg,
                const chain::Address& wallet,
                std::size_t max_positions = 30);

}  // namespace cryptoapp::defi
