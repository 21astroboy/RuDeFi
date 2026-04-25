cmake_minimum_required(VERSION 3.20)
project(cryptoapp
    VERSION 0.1.0
    DESCRIPTION "Multi-chain DeFi portfolio dashboard (RU)"
    LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

# ----------------------------- Warnings ---------------------------------------
if(MSVC)
    add_compile_options(/W4 /permissive-)
else()
    add_compile_options(-Wall -Wextra -Wpedantic -Wno-unused-parameter)
    # Performance flags for Release
    if(CMAKE_BUILD_TYPE STREQUAL "Release")
        add_compile_options(-O3 -fno-omit-frame-pointer)
    endif()
endif()

# ----------------------------- Dependencies -----------------------------------
include(FetchContent)
set(FETCHCONTENT_QUIET FALSE)

# nlohmann/json (header-only)
FetchContent_Declare(
    nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(nlohmann_json)

# CLI11 for argument parsing (header-only)
FetchContent_Declare(
    cli11
    GIT_REPOSITORY https://github.com/CLIUtils/CLI11.git
    GIT_TAG v2.4.2
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(cli11)

# cpp-httplib (single-header HTTP server/client)
FetchContent_Declare(
    httplib
    GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
    GIT_TAG v0.16.3
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(httplib)

# libcurl — HTTP client. Try system first; fall back to FetchContent.
find_package(CURL QUIET)
if(NOT CURL_FOUND)
    message(STATUS "System libcurl not found; will rely on user installing it. "
                   "Install with: brew install curl  /  apt install libcurl4-openssl-dev")
    find_package(CURL REQUIRED)
endif()

# Boost.Multiprecision for 256-bit integers (header-only). System install preferred.
find_package(Boost 1.74 QUIET COMPONENTS headers)
if(NOT Boost_FOUND)
    # Fallback: minimal vendored u256 in util/u256.hpp would go here.
    message(STATUS "Boost not found; install with: brew install boost  /  apt install libboost-dev")
    find_package(Boost 1.74 REQUIRED)
endif()

# ----------------------------- Library: cryptoapp_core ------------------------
add_library(cryptoapp_core STATIC
    src/util/hex.cpp
    src/util/http.cpp
    src/chain/eth_types.cpp
    src/chain/rpc_client.cpp
    src/chain/multicall.cpp
    src/chain/chain_config.cpp
    src/chain/gas_tracker.cpp
    src/pricing/price_service.cpp
    src/pricing/fx_service.cpp
    src/defi/aave_v3.cpp
    src/defi/compound_v3.cpp
    src/defi/uniswap_v3.cpp
    src/defi/uniswap_v3_math.cpp
    src/bridges/lifi_client.cpp
    src/yield/llama_client.cpp
    src/security/approvals.cpp
    src/security/goplus_client.cpp
    src/portfolio/portfolio_scanner.cpp
    src/portfolio/scan_json.cpp
    src/server/http_server.cpp
)

target_include_directories(cryptoapp_core
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(cryptoapp_core
    PUBLIC
        nlohmann_json::nlohmann_json
        Boost::headers
    PRIVATE
        CURL::libcurl
        httplib::httplib
)

# httplib needs threads.
find_package(Threads REQUIRED)
target_link_libraries(cryptoapp_core PRIVATE Threads::Threads)

# ----------------------------- App: cli ---------------------------------------
add_executable(cryptoapp apps/cli/main.cpp)
target_link_libraries(cryptoapp
    PRIVATE
        cryptoapp_core
        CLI11::CLI11
)

# Copy config + ui next to the binary for convenient running.
add_custom_command(TARGET cryptoapp POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
            ${CMAKE_CURRENT_SOURCE_DIR}/config
            $<TARGET_FILE_DIR:cryptoapp>/config
    COMMAND ${CMAKE_COMMAND} -E copy_directory
            ${CMAKE_CURRENT_SOURCE_DIR}/ui
            $<TARGET_FILE_DIR:cryptoapp>/ui
)

# ----------------------------- Install ----------------------------------------
install(TARGETS cryptoapp RUNTIME DESTINATION bin)
install(DIRECTORY config/ DESTINATION share/cryptoapp/config)
install(DIRECTORY ui/ DESTINATION share/cryptoapp/ui)
