#include "cryptoapp/chain/multicall.hpp"

#include "cryptoapp/util/hex.hpp"

#include <iomanip>
#include <sstream>
#include <stdexcept>

namespace cryptoapp::chain {

// ---------- Tiny ABI helpers (just what we need) -----------------------------

namespace {

// Selectors (precomputed keccak256 first 4 bytes).
//   bytes4(keccak256("aggregate3((address,bool,bytes)[])"))     == 0x82ad56cb
//   bytes4(keccak256("balanceOf(address)"))                     == 0x70a08231
//   bytes4(keccak256("decimals()"))                             == 0x313ce567
constexpr const char* SEL_AGGREGATE3   = "82ad56cb";
constexpr const char* SEL_BALANCE_OF   = "70a08231";
constexpr const char* SEL_DECIMALS     = "313ce567";

// Append a uint as a 32-byte big-endian word in hex.
void append_word_uint(std::string& out, std::uint64_t v) {
    char buf[17];
    std::snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(v));
    out.append(48, '0');   // 48 leading zeros for the high 24 bytes
    out.append(buf, 16);   // last 8 bytes (16 hex chars) hold the value
}

// Append a 20-byte address right-aligned in a 32-byte word.
void append_word_address(std::string& out, const Address& a) {
    out.append(24, '0');
    auto h = util::hex_encode(a.bytes().data(), a.bytes().size());
    // hex_encode adds "0x"; strip it.
    out.append(h, 2, std::string::npos);
}

// Append a bool as a 32-byte word.
void append_word_bool(std::string& out, bool b) {
    out.append(63, '0');
    out.push_back(b ? '1' : '0');
}

// Append raw hex (no 0x) padded to a multiple of 64 chars (= 32 bytes), zero-padded on the right.
void append_padded_bytes(std::string& out, std::string_view raw_hex) {
    out.append(raw_hex);
    std::size_t pad = (64 - raw_hex.size() % 64) % 64;
    if (pad) out.append(pad, '0');
}

// Read a 32-byte word from `hex` at byte-offset `off` (off is in BYTES from start of hex).
// Returns substring (64 chars).
std::string_view word_at(std::string_view hex, std::size_t byte_off) {
    std::size_t pos = byte_off * 2;
    if (pos + 64 > hex.size()) {
        throw std::runtime_error("ABI decode: word out of range");
    }
    return hex.substr(pos, 64);
}

std::uint64_t word_to_u64(std::string_view word) {
    // The value should fit in 64 bits for offsets/lengths we deal with.
    // Take last 16 hex chars.
    if (word.size() != 64) throw std::runtime_error("word_to_u64: bad word");
    // Ensure leading bytes are zero.
    for (std::size_t i = 0; i < 48; ++i) {
        if (word[i] != '0') throw std::runtime_error("word_to_u64: value > uint64");
    }
    return util::parse_hex_uint64(word.substr(48));
}

}  // namespace

std::string encode_erc20_balance_of(const Address& holder) {
    std::string s = "0x";
    s.append(SEL_BALANCE_OF);
    append_word_address(s, holder);
    return s;
}

std::string encode_erc20_decimals() {
    return std::string("0x") + SEL_DECIMALS;
}

std::string encode_aggregate3(const std::vector<Call3>& calls) {
    // Layout (after 4-byte selector):
    //   word: 0x20  (offset to array body)
    //   word: N     (array length)
    //   N words: offset[i] of tuple i, relative to start of array body's "elements data" section.
    //   For i = 0..N-1: tuple body
    //     word: address
    //     word: bool
    //     word: 0x60 (offset to bytes within tuple)
    //     word: bytes length
    //     bytes data, padded to 32 bytes
    //
    // Offsets "within" array body, per the ABI spec for `T[]` of dynamic T,
    // are relative to the start of the array body (i.e., right after length).
    // Hmm — actually in solidity ABI, offsets in head[i] point to tail[i]
    // from the beginning of the *array's data area* (which here means right
    // after the length word — i.e., the start of the head[0] word).

    const std::size_t N = calls.size();

    // Pre-encode each tuple body into a string of hex (no 0x).
    std::vector<std::string> tuples;
    tuples.reserve(N);
    for (const auto& c : calls) {
        std::string t;
        append_word_address(t, c.target);
        append_word_bool(t, c.allow_failure);
        // bytes offset within tuple = 3 words = 96 = 0x60.
        append_word_uint(t, 0x60);
        // bytes length
        auto data = util::normalize_hex(c.call_data_hex);
        std::uint64_t byte_len = data.size() / 2;
        append_word_uint(t, byte_len);
        append_padded_bytes(t, data);
        tuples.push_back(std::move(t));
    }

    // Compute offsets for each tuple, in bytes, relative to start of "heads section".
    // First N words are the head offsets themselves.
    std::vector<std::uint64_t> offsets(N);
    std::uint64_t cur = N * 32;  // first tuple starts after the N head words
    for (std::size_t i = 0; i < N; ++i) {
        offsets[i] = cur;
        cur += tuples[i].size() / 2;  // bytes
    }

    std::string out = "0x";
    out.append(SEL_AGGREGATE3);

    // outer offset to array body = 0x20 (just past this word)
    append_word_uint(out, 0x20);
    // length
    append_word_uint(out, static_cast<std::uint64_t>(N));
    // head offsets
    for (auto o : offsets) append_word_uint(out, o);
    // tails
    for (auto& t : tuples) out.append(t);

    return out;
}

std::vector<Call3Result> decode_aggregate3(std::string_view return_hex) {
    // Output: (bool,bytes)[] — same layout as encoded above.
    auto h = util::normalize_hex(return_hex);
    if (h.size() < 64) return {};

    // First word: outer offset (should be 0x20).
    auto outer_off_word = word_at(h, 0);
    std::uint64_t outer_off = word_to_u64(outer_off_word);
    // Array body starts at outer_off. The length is the first word there.
    std::uint64_t len = word_to_u64(word_at(h, outer_off));
    std::uint64_t heads_start = outer_off + 32;

    std::vector<Call3Result> results;
    results.reserve(len);
    for (std::uint64_t i = 0; i < len; ++i) {
        std::uint64_t head_word_pos = heads_start + i * 32;
        std::uint64_t tuple_off_rel = word_to_u64(word_at(h, head_word_pos));
        std::uint64_t tuple_pos = heads_start + tuple_off_rel;

        // tuple: bool, offset_to_bytes, then bytes data
        std::uint64_t success = word_to_u64(word_at(h, tuple_pos));
        std::uint64_t bytes_off_rel = word_to_u64(word_at(h, tuple_pos + 32));
        std::uint64_t bytes_pos = tuple_pos + bytes_off_rel;
        std::uint64_t bytes_len = word_to_u64(word_at(h, bytes_pos));

        Call3Result r;
        r.success = (success != 0);
        std::string raw;
        if (bytes_len > 0) {
            std::size_t start = (bytes_pos + 32) * 2;
            std::size_t want = bytes_len * 2;
            if (start + want > h.size()) {
                throw std::runtime_error("decode_aggregate3: bytes out of range");
            }
            raw.assign(h, start, want);
        }
        r.return_data_hex = "0x" + raw;
        results.push_back(std::move(r));
    }
    return results;
}

std::vector<Call3Result> aggregate3(RpcClient& rpc,
                                    const Address& multicall3,
                                    const std::vector<Call3>& calls) {
    if (calls.empty()) return {};
    auto data = encode_aggregate3(calls);
    auto ret = rpc.eth_call_hex(multicall3, data);
    return decode_aggregate3(ret);
}

}  // namespace cryptoapp::chain
