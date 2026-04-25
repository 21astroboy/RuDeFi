#include "cryptoapp/chain/rpc_client.hpp"

#include "cryptoapp/util/hex.hpp"

#include <algorithm>
#include <cctype>
#include <stdexcept>
#include <thread>

namespace cryptoapp::chain {

namespace {

// Returns true for RPC errors that we should retry on a different endpoint
// rather than treat as a fatal protocol error. These are typically caused by
// public RPC nodes being out of sync, rate-limited, or briefly overloaded.
bool is_transient_rpc_error(const nlohmann::json& err) {
    // Numeric codes used by various clients to signal transient conditions.
    if (err.contains("code") && err["code"].is_number_integer()) {
        const long code = err["code"].get<long>();
        switch (code) {
            case -32005:    // request limit / rate-limit
            case -32603:    // internal error (often "header not found")
            case -32014:    // some providers use this for stale state
            case -32099:    // Alchemy: server-side problem
            case -32700:    // parse error — typically gateway returned non-JSON
                            // (an upstream-down message rendered as HTML/text)
            case  429:      // rate limited
            case  502:      // bad gateway
            case  503:      // service unavailable
            case  504:      // gateway timeout
                return true;
            default: break;
        }
    }
    // Keyword sniffing on both message + data fields. Public RPCs and their
    // proxies (Cloudflare, Envoy, etc.) report failures here in non-standard
    // formats — we just look for known infrastructure errors.
    auto sniff = [](std::string s) {
        std::transform(s.begin(), s.end(), s.begin(),
                       [](unsigned char c){ return std::tolower(c); });
        static const char* keywords[] = {
            "header not found",
            "rate limit",
            "limit exceeded",
            "request failed",
            "timeout",
            "temporarily unavailable",
            "service unavailable",
            "try again",
            "overloaded",
            "internal error",
            "upstream connect",          // envoy/gateway: backend unreachable
            "connect error",
            "connection refused",
            "connection reset",
            "reset before headers",
            "remote connection failure",
            "transport failure",
            "bad gateway",
            "gateway timeout",
            "no healthy upstream",
            "upstream request timeout",
            "503 ", "504 ",
        };
        for (const auto* k : keywords) {
            if (s.find(k) != std::string::npos) return true;
        }
        return false;
    };
    if (err.contains("message") && err["message"].is_string()) {
        if (sniff(err["message"].get<std::string>())) return true;
    }
    if (err.contains("data") && err["data"].is_string()) {
        if (sniff(err["data"].get<std::string>())) return true;
    }
    return false;
}

}  // namespace

RpcClient::RpcClient(std::vector<std::string> endpoints,
                     std::shared_ptr<util::HttpClient> http)
    : endpoints_(std::move(endpoints)), http_(std::move(http)) {
    if (endpoints_.empty()) {
        throw std::invalid_argument("RpcClient: empty endpoint list");
    }
    if (!http_) http_ = std::make_shared<util::HttpClient>();
}

nlohmann::json RpcClient::call(std::string_view method, nlohmann::json params) {
    const std::uint64_t id = next_id_.fetch_add(1, std::memory_order_relaxed);
    nlohmann::json req = {
        {"jsonrpc", "2.0"},
        {"id", id},
        {"method", std::string(method)},
        {"params", std::move(params)},
    };
    const std::string body = req.dump();

    const std::size_t n = endpoints_.size();
    std::string last_error;
    for (std::size_t attempt = 0; attempt < n; ++attempt) {
        const std::size_t idx = (rr_.load(std::memory_order_relaxed) + attempt) % n;
        const auto& ep = endpoints_[idx];
        auto resp = http_->post_json(ep, body);
        if (!resp.ok()) {
            last_error = "HTTP " + std::to_string(resp.status) + " from " + ep + ": " + resp.error;
            continue;
        }
        nlohmann::json j;
        try {
            j = nlohmann::json::parse(resp.body);
        } catch (const std::exception& e) {
            last_error = std::string("parse error: ") + e.what() + " body: " + resp.body.substr(0, 200);
            continue;
        }
        if (j.contains("error") && !j["error"].is_null()) {
            // Transient errors (rate limits, stale state, "header not found")
            // — try the next endpoint instead of failing the whole request.
            if (is_transient_rpc_error(j["error"])) {
                last_error = "transient RPC error from " + ep + ": " + j["error"].dump();
                continue;
            }
            // Hard errors (method not found, bad params) propagate immediately.
            throw RpcError(j["error"].dump());
        }
        if (!j.contains("result")) {
            last_error = "missing result: " + resp.body.substr(0, 200);
            continue;
        }
        // Success: prefer this endpoint next time.
        rr_.store(idx, std::memory_order_relaxed);
        return j["result"];
    }
    throw RpcError("all RPC endpoints failed: " + last_error);
}

std::uint64_t RpcClient::eth_chain_id() {
    auto r = call("eth_chainId", nlohmann::json::array());
    return util::parse_hex_uint64(r.get<std::string>());
}

U256 RpcClient::eth_get_balance(const Address& a) {
    auto r = call("eth_getBalance", nlohmann::json::array({a.hex(), "latest"}));
    return parse_hex_u256(r.get<std::string>());
}

std::string RpcClient::eth_call_hex(const Address& to, std::string_view data_hex) {
    nlohmann::json call_obj = {
        {"to", to.hex()},
        {"data", std::string(data_hex)},
    };
    auto r = call("eth_call", nlohmann::json::array({call_obj, "latest"}));
    return r.get<std::string>();
}

U256 RpcClient::eth_gas_price() {
    auto r = call("eth_gasPrice", nlohmann::json::array());
    return parse_hex_u256(r.get<std::string>());
}

}  // namespace cryptoapp::chain
