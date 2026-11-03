// http_server.hpp - Tiny HTTP server exposing /api/* and serving the UI.
//
// Wraps cpp-httplib so other call sites don't have to drag the header in.
#pragma once

#include "cryptoapp/bridges/lifi_client.hpp"
#include "cryptoapp/chain/chain_config.hpp"
#include "cryptoapp/chain/gas_tracker.hpp"
#include "cryptoapp/portfolio/portfolio_scanner.hpp"
#include "cryptoapp/pricing/fx_service.hpp"
#include "cryptoapp/pricing/price_service.hpp"
#include "cryptoapp/security/approvals.hpp"
#include "cryptoapp/security/goplus_client.hpp"
#include "cryptoapp/yield/llama_client.hpp"

#include <filesystem>
#include <memory>
#include <string>

namespace cryptoapp::server {

struct ServeOptions {
    std::string bind_addr = "127.0.0.1";
    int port = 8787;
    std::filesystem::path ui_dir;        // optional; if empty, no static UI
    std::string allowed_origin = "*";    // CORS origin (use "*" only for localhost dev)
};

struct ServerDeps {
    const chain::Registry* registry = nullptr;
    std::shared_ptr<portfolio::PortfolioScanner> scanner;
    std::shared_ptr<bridges::LifiClient> lifi;
    std::shared_ptr<pricing::FxService> fx;
    std::shared_ptr<yield::LlamaClient> yields;
    std::shared_ptr<chain::GasTracker> gas;
    std::shared_ptr<security::ApprovalScanner> approvals;
    std::shared_ptr<security::GoplusClient> goplus;
    std::shared_ptr<pricing::PriceService> prices;
    std::shared_ptr<util::HttpClient> http;          // lets server build per-chain RPCs on demand
};

class HttpServer {
public:
    HttpServer(ServerDeps deps, ServeOptions opts);
    ~HttpServer();
    HttpServer(const HttpServer&) = delete;
    HttpServer& operator=(const HttpServer&) = delete;

    // Blocks until SIGINT / stop().
    void run();
    void stop();

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace cryptoapp::server
