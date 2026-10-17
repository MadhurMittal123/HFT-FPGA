
module uart_price_frontend #(
    parameter integer DATA_WIDTH = 32,
     parameter integer MAX_DIGITS=10
    
) (
    // existing ports
   input  wire        clk,
    input  wire        rst,
    input  wire        uart_rx_pin,

    output wire [31:0] price,
    output wire        price_valid,
    output wire        line_error
); 
assign price_valid = parser_price_valid;
assign line_error  = parser_line_error;
   // wire [7:0] data_out;
   // wire data_valid;
(* MARK_DEBUG = "TRUE" *) wire [7:0] data_out;
(* MARK_DEBUG = "TRUE" *) wire data_valid;
(* MARK_DEBUG = "TRUE" *) wire parser_price_valid;
(* MARK_DEBUG = "TRUE" *) wire parser_line_error;
    uart_rx #(
        .CLK_FREQ(100_000_000),
        .BAUD_RATE(115200)
    ) uart_receiver (
        .clk(clk),
        .rst(rst),
        .rx(uart_rx_pin),
        .data_out(data_out),
        .data_valid(data_valid)
    );

    price_parser #(
        .DATA_WIDTH(32),
        .MAX_DIGITS(10)
    ) parser (
        .clk(clk),
        .rst(rst),
        .data_in(data_out),
        .data_valid(data_valid),
        .price(price),
        .price_valid(parser_price_valid),
.line_error(parser_line_error)
    );

endmodule
