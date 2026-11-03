// rpc_client.hpp - JSON-RPC client with multi-endpoint failover.
#pragma once

#include "cryptoapp/chain/eth_types.hpp"
#include "cryptoapp/util/http.hpp"

#include <nlohmann/json.hpp>

#include <atomic>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace cryptoapp::chain {

class RpcError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

// Calls JSON-RPC over HTTP. Holds a list of endpoints and rotates on failure.
class RpcClient {
public:
    RpcClient(std::vector<std::string> endpoints,
              std::shared_ptr<util::HttpClient> http);

    // Generic JSON-RPC call. Throws RpcError on RPC-level error.
    nlohmann::json call(std::string_view method, nlohmann::json params);

    // eth_chainId -> uint64.
    [[nodiscard]] std::uint64_t eth_chain_id();

    // eth_getBalance(address, "latest") -> wei.
    [[nodiscard]] U256 eth_get_balance(const Address& a);

    // eth_call({to,data}, "latest") -> hex result.
    [[nodiscard]] std::string eth_call_hex(const Address& to, std::string_view data_hex);

    // eth_gasPrice -> wei.
    [[nodiscard]] U256 eth_gas_price();

private:
    std::vector<std::string> endpoints_;
    std::shared_ptr<util::HttpClient> http_;
    std::atomic<std::size_t> rr_{0};
    std::atomic<std::uint64_t> next_id_{1};
};

}  // namespace cryptoapp::chain
