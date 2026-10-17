

// market_signal.v  (cost-aware mean reversion with bounce confirmation)
//
// BUY  : price is at least THRESHOLD below the rolling average
//        AND (if CONFIRM=1) the latest tick is higher than the previous one,
//        i.e. the fall has stopped. Avoids buying into a falling market.
// SELL : price has come back to (or above) the average. risk_manager decides
//        whether selling is actually worthwhile (profit check).
// HOLD : otherwise, and during warm-up (fewer than 2 ticks seen).
//
// THRESHOLD is in the same units as price (paise). Set it above the typical
// spread + fees, otherwise every trade starts with a built-in loss.
//
// Assumption (same as your old code): average_valid arrives at least one
// clock after tick_valid, so cur_price already holds the newest tick.
module market_signal #(
    parameter DATA_WIDTH = 32,
    parameter THRESHOLD  = 10,
    parameter CONFIRM    = 1
) (
    input  wire                  clk,
    input  wire                  rst,
    input  wire                  tick_valid,
    input  wire [DATA_WIDTH-1:0] price,
    input  wire [DATA_WIDTH-1:0] average,
    input  wire                  average_valid,
 
    output reg  [1:0]            signal,
    output reg                   signal_valid,
    output reg  [DATA_WIDTH-1:0] signal_price   // price this signal was based on
);
 
    localparam HOLD = 2'b00;
    localparam BUY  = 2'b01;
    localparam SELL = 2'b10;
 
    reg [DATA_WIDTH-1:0] cur_price;
    reg [DATA_WIDTH-1:0] prev_price;
    reg [1:0]            ticks_seen;
 
    // One extra bit so adding THRESHOLD can never wrap around.
    wire [DATA_WIDTH:0] cur_plus_thr = {1'b0, cur_price} + THRESHOLD;
    wire [DATA_WIDTH:0] avg_ext      = {1'b0, average};
 
    wire dip         = (cur_plus_thr <= avg_ext);          // far enough below average
    wire bounce_ok   = (CONFIRM == 0) || (cur_price > prev_price);
    wire back_at_avg = (cur_price >= average);
 
    always @(posedge clk) begin
        if (rst) begin
            cur_price    <= 0;
            prev_price   <= 0;
            ticks_seen   <= 0;
            signal       <= HOLD;
            signal_valid <= 0;
            signal_price <= 0;
        end else begin
            signal_valid <= 0;
 
            if (tick_valid) begin
                cur_price  <= price;
                prev_price <= cur_price;
                if (ticks_seen != 2'd3)
                    ticks_seen <= ticks_seen + 1'b1;
            end
 
            if (average_valid) begin
                signal_valid <= 1;
                signal_price <= cur_price;
 
                if (ticks_seen < 2)
                    signal <= HOLD;
                else if (dip && bounce_ok)
                    signal <= BUY;
                else if (back_at_avg)
                    signal <= SELL;
                else
                    signal <= HOLD;
            end
        end
    end
 
endmodule
 

