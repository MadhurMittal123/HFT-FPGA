module uart_hft_top (
    input  wire        clk,
    input  wire        rst,
    input  wire        uart_rx_pin,
    input  wire [31:0] trade_qty,

    output wire [31:0] price,
    output wire        price_valid,
    output wire        line_error,

    output wire        order_valid,
    output wire [1:0]  order_side,
    output wire [31:0] order_qty,
    output wire [31:0] position,
    output wire        risk_reject
);

    uart_price_frontend frontend (
        .clk(clk),
        .rst(rst),
        .uart_rx_pin(uart_rx_pin),
        .price(price),
        .price_valid(price_valid),
        .line_error(line_error)
    );

    hft_core #(
        .DATA_WIDTH(32),
        .THRESHOLD(5),
        .WINDOW(4)
    ) core (
        .clk(clk),
        .rst(rst),
        .tick_valid(price_valid),
        .price(price),
        .trade_qty(trade_qty),
        .order_valid(order_valid),
        .order_side(order_side),
        .order_qty(order_qty),
        .position(position),
        .risk_reject(risk_reject)
    );

endmodule
