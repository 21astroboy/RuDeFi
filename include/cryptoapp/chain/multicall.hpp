// multicall.hpp - Multicall3 (aggregate3) batched read.
//
// One eth_call returns balances/values for many addresses in a single round-trip.
// This is the single biggest win for sub-second portfolio scans.
#pragma once

#include "cryptoapp/chain/eth_types.hpp"
#include "cryptoapp/chain/rpc_client.hpp"

#include <optional>
#include <string>
#include <vector>

namespace cryptoapp::chain {

struct Call3 {
    Address target;
    bool allow_failure = true;
    std::string call_data_hex;  // 0x-prefixed
};

struct Call3Result {
    bool success = false;
    std::string return_data_hex;  // 0x-prefixed
};

// ABI-encode a single ERC-20 balanceOf(address) call for `holder`.
[[nodiscard]] std::string encode_erc20_balance_of(const Address& holder);

// ABI-encode a single ERC-20 decimals() call.
[[nodiscard]] std::string encode_erc20_decimals();

// ABI-encode aggregate3((address,bool,bytes)[]). Returns full calldata (0x...).
[[nodiscard]] std::string encode_aggregate3(const std::vector<Call3>& calls);

// Decode the aggregate3 result blob into per-call results.
[[nodiscard]] std::vector<Call3Result> decode_aggregate3(std::string_view return_hex);

// High-level helper: run aggregate3 on a Multicall3 contract via the given RPC.
[[nodiscard]] std::vector<Call3Result> aggregate3(RpcClient& rpc,
                                                  const Address& multicall3,
                                                  const std::vector<Call3>& calls);

}  // namespace cryptoapp::chain
