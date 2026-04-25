// cryptoapp CLI: scan a wallet across all configured chains, or run a local
// HTTP server that backs the web UI.
//
// Usage:
//   cryptoapp scan 0xYourAddress
//   cryptoapp serve [--port 8787] [--bind 127.0.0.1]
//
// More commands (bridge, arb, watch) will hang off this same skeleton.

#include "cryptoapp/bridges/lifi_client.hpp"
#include "cryptoapp/chain/chain_config.hpp"
#include "cryptoapp/chain/eth_types.hpp"
#include "cryptoapp/chain/gas_tracker.hpp"
#include "cryptoapp/portfolio/portfolio_scanner.hpp"
#include "cryptoapp/pricing/fx_service.hpp"
#include "cryptoapp/pricing/price_service.hpp"
#include "cryptoapp/security/approvals.hpp"
#include "cryptoapp/security/goplus_client.hpp"
#include "cryptoapp/server/http_server.hpp"
#include "cryptoapp/util/http.hpp"
#include "cryptoapp/yield/llama_client.hpp"

#include <CLI/CLI.hpp>

#include <chrono>
#include <cstdio>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <memory>
#include <string>

namespace fs = std::filesystem;

namespace {

struct AppCtx {
    std::shared_ptr<cryptoapp::util::HttpClient> http;
    std::shared_ptr<cryptoapp::pricing::PriceService> prices;
    std::shared_ptr<cryptoapp::pricing::FxService> fx;
    std::unique_ptr<cryptoapp::chain::Registry> registry;
    std::shared_ptr<cryptoapp::portfolio::PortfolioScanner> scanner;
    fs::path config_dir;
    fs::path ui_dir;
};

fs::path locate_dir(const char* name) {
    for (auto p : {fs::path(name),
                   fs::path("..") / name,
                   fs::path("/usr/local/share/cryptoapp") / name}) {
        if (fs::exists(p)) return p;
    }
    return {};
}

AppCtx make_ctx() {
    AppCtx ctx;
    ctx.config_dir = locate_dir("config");
    if (ctx.config_dir.empty() || !fs::exists(ctx.config_dir / "chains.json")) {
        throw std::runtime_error("config/chains.json not found "
                                 "(run from the build dir or install with `cmake --install`)");
    }
    ctx.ui_dir = locate_dir("ui");

    ctx.registry = std::make_unique<cryptoapp::chain::Registry>(
        cryptoapp::chain::Registry::load(ctx.config_dir / "chains.json",
                                         ctx.config_dir / "tokens.json"));

    ctx.http = std::make_shared<cryptoapp::util::HttpClient>();
    ctx.prices = std::make_shared<cryptoapp::pricing::PriceService>(ctx.http);
    ctx.fx = std::make_shared<cryptoapp::pricing::FxService>(ctx.http);
    ctx.scanner = std::make_shared<cryptoapp::portfolio::PortfolioScanner>(
        *ctx.registry, ctx.http, ctx.prices, ctx.fx);
    return ctx;
}

std::string fmt_money(double v) {
    char buf[64];
    if (v >= 1000)      std::snprintf(buf, sizeof(buf), "%.2f", v);
    else if (v >= 1)    std::snprintf(buf, sizeof(buf), "%.2f", v);
    else                std::snprintf(buf, sizeof(buf), "%.4f", v);
    return std::string(buf);
}

int run_scan(const std::string& wallet_str, bool include_zero, bool no_prices) {
    cryptoapp::util::http_global_init();
    auto ctx = make_ctx();
    auto wallet = cryptoapp::chain::Address::from_hex(wallet_str);

    cryptoapp::portfolio::ScanOptions opts;
    opts.include_zero = include_zero;
    opts.fetch_prices = !no_prices;

    auto t0 = std::chrono::steady_clock::now();
    auto res = ctx.scanner->scan(wallet, opts);
    auto t1 = std::chrono::steady_clock::now();
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

    for (const auto& w : res.warnings) std::cerr << "warn: " << w << "\n";

    std::cout << "\n  Wallet:   " << wallet.hex() << "\n";
    std::cout << "  Scanned:  " << ctx.registry->chains().size()
              << " chains in " << ms << " ms\n";
    if (res.usd_rub_rate > 0) {
        std::cout << "  USD/RUB:  " << std::fixed << std::setprecision(2)
                  << res.usd_rub_rate << " (CBR)\n";
    }
    std::cout << "\n";

    std::printf("  %-9s %-8s %22s %14s %14s %16s\n",
                "CHAIN", "ASSET", "AMOUNT", "PRICE,$", "VALUE,$", "VALUE,RUB");
    std::printf("  %s\n", std::string(96, '-').c_str());

    for (const auto& h : res.holdings) {
        std::string amt = cryptoapp::chain::format_units(h.raw_balance, h.decimals, 6);
        std::string price = h.price_usd > 0 ? fmt_money(h.price_usd) : "-";
        std::string vusd  = h.price_usd > 0 ? fmt_money(h.value_usd) : "-";
        std::string vrub  = (h.price_usd > 0 && res.usd_rub_rate > 0)
                            ? fmt_money(h.value_rub) : "-";
        std::printf("  %-9s %-8s %22s %14s %14s %16s\n",
                    h.chain_key.c_str(), h.symbol.c_str(),
                    amt.c_str(), price.c_str(), vusd.c_str(), vrub.c_str());
    }
    std::printf("  %s\n", std::string(96, '-').c_str());
    std::printf("  %-65s %14s %16s\n", "TOTAL",
                fmt_money(res.total_usd).c_str(),
                (res.usd_rub_rate > 0 ? fmt_money(res.total_rub) : std::string("-")).c_str());
    std::cout << "\n";

    cryptoapp::util::http_global_cleanup();
    return 0;
}

int run_serve(int port, const std::string& bind_addr) {
    cryptoapp::util::http_global_init();
    auto ctx = make_ctx();

    auto lifi   = std::make_shared<cryptoapp::bridges::LifiClient>(ctx.http);
    auto yields = std::make_shared<cryptoapp::yield::LlamaClient>(ctx.http);
    auto gas    = std::make_shared<cryptoapp::chain::GasTracker>(*ctx.registry, ctx.http);
    auto appr   = std::make_shared<cryptoapp::security::ApprovalScanner>(*ctx.registry, ctx.http);
    auto goplus = std::make_shared<cryptoapp::security::GoplusClient>(ctx.http);

    cryptoapp::server::ServeOptions opts;
    opts.bind_addr = bind_addr;
    opts.port = port;
    opts.ui_dir = ctx.ui_dir;
    opts.allowed_origin = "*";  // local dev; tighten later

    cryptoapp::server::ServerDeps deps;
    deps.registry = ctx.registry.get();
    deps.scanner  = ctx.scanner;
    deps.lifi     = std::move(lifi);
    deps.fx       = ctx.fx;
    deps.yields   = std::move(yields);
    deps.gas      = std::move(gas);
    deps.approvals= std::move(appr);
    deps.goplus   = std::move(goplus);
    deps.prices   = ctx.prices;
    deps.http     = ctx.http;

    cryptoapp::server::HttpServer srv(std::move(deps), std::move(opts));
    srv.run();  // blocks
    cryptoapp::util::http_global_cleanup();
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    CLI::App app{"cryptoapp - fast multi-chain portfolio & arbitrage toolkit"};
    app.require_subcommand(1);

    auto* scan = app.add_subcommand("scan", "Scan a wallet across all chains");
    std::string wallet;
    bool include_zero = false;
    bool no_prices = false;
    scan->add_option("wallet", wallet, "0x... wallet address")->required();
    scan->add_flag("--include-zero", include_zero, "Show tokens with zero balance");
    scan->add_flag("--no-prices", no_prices, "Skip USD/RUB pricing");

    auto* serve = app.add_subcommand("serve", "Run local HTTP server + web UI");
    int port = 8787;
    std::string bind = "127.0.0.1";
    serve->add_option("--port", port, "TCP port (default 8787)");
    serve->add_option("--bind", bind, "Bind address (default 127.0.0.1)");

    CLI11_PARSE(app, argc, argv);

    try {
        if (*scan)  return run_scan(wallet, include_zero, no_prices);
        if (*serve) return run_serve(port, bind);
    } catch (const std::exception& e) {
        std::cerr << "error: " << e.what() << "\n";
        return 1;
    }
    return 0;
}
