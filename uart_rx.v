
module uart_rx #(
    parameter CLK_FREQ  = 100_000_000,
    parameter BAUD_RATE = 115200
)(
    input wire clk,
    input wire rst,
    input wire rx,

    output reg [7:0] data_out,
    output reg data_valid
);

    localparam CLKS_PER_BIT = CLK_FREQ / BAUD_RATE;
    localparam HALF_BIT     = CLKS_PER_BIT / 2;

    localparam IDLE  = 2'b00;
    localparam START = 2'b01;
    localparam DATA  = 2'b10;
    localparam STOP  = 2'b11;

    reg [1:0] state;
    reg [31:0] clk_count;
    reg [2:0] bit_index;

    // Two-flop synchronizer for the asynchronous UART input.
    reg rx_meta;
    reg rx_sync;

    always @(posedge clk) begin
        if (rst) begin
            rx_meta <= 1'b1;
            rx_sync <= 1'b1;
        end else begin
            rx_meta <= rx;
            rx_sync <= rx_meta;
        end
    end

    always @(posedge clk) begin
        if (rst) begin
            state      <= IDLE;
            clk_count  <= 0;
            bit_index  <= 0;
            data_out   <= 8'b0;
            data_valid <= 1'b0;
        end else begin
            // Default: data_valid is a one-clock pulse.
            data_valid <= 1'b0;

            case (state)

                IDLE: begin
                    clk_count <= 0;
                    bit_index <= 0;

                    // UART line goes low at the start bit.
                    if (rx_sync == 1'b0)
                        state <= START;
                end

                START: begin
                    // Sample near the center of the start bit.
                    if (clk_count == HALF_BIT - 1) begin
                        clk_count <= 0;

                        if (rx_sync == 1'b0)
                            state <= DATA;
                        else
                            state <= IDLE;
                    end else begin
                        clk_count <= clk_count + 1;
                    end
                end

                DATA: begin
                    // Sample each data bit at its center.
                    if (clk_count == CLKS_PER_BIT - 1) begin
                        clk_count <= 0;
                        data_out[bit_index] <= rx_sync;

                        if (bit_index == 3'd7) begin
                            bit_index <= 0;
                            state <= STOP;
                        end else begin
                            bit_index <= bit_index + 1;
                        end
                    end else begin
                        clk_count <= clk_count + 1;
                    end
                end

                STOP: begin
                    // Accept the byte only if the stop bit is high.
                    if (clk_count == CLKS_PER_BIT - 1) begin
                        clk_count <= 0;
                        state <= IDLE;

                        if (rx_sync == 1'b1)
                            data_valid <= 1'b1;
                    end else begin
                        clk_count <= clk_count + 1;
                    end
                end

                default: begin
                    state <= IDLE;
                    clk_count <= 0;
                    bit_index <= 0;
                end

            endcase
        end
    end

endmodule
