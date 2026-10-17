
`timescale 1ns / 1ps

module price_parser #(
    parameter DATA_WIDTH = 32,
    parameter MAX_DIGITS = 10
)(
    input wire clk,
    input wire rst,
    input wire [7:0] data_in,
    input wire data_valid,

    output reg [DATA_WIDTH-1:0] price,
    output reg price_valid,
    output reg line_error
);

    localparam [7:0] ASCII_ZERO = 8'h30;
    localparam [7:0] ASCII_NINE = 8'h39;
    localparam [7:0] ASCII_LF   = 8'h0A;
    localparam [7:0] ASCII_CR   = 8'h0D;

    reg [DATA_WIDTH-1:0] accumulator;
    reg [3:0] digit_count;
    reg line_invalid;
    reg skip_lf;

    reg [DATA_WIDTH-1:0] digit_value;
    reg [DATA_WIDTH-1:0] next_value;

    // Convert the incoming ASCII digit into a number.
    always @(*) begin
        digit_value = {DATA_WIDTH{1'b0}};
        next_value  = accumulator;

        if (data_in >= ASCII_ZERO && data_in <= ASCII_NINE) begin
            digit_value = data_in - ASCII_ZERO;
            next_value = accumulator * 10 + digit_value;
        end
    end

    always @(posedge clk) begin
        if (rst) begin
            price        <= 0;
            price_valid  <= 0;
            line_error   <= 0;
            accumulator  <= 0;
            digit_count  <= 0;
            line_invalid <= 0;
            skip_lf      <= 0;
        end else begin
            // Default: clear one-cycle output pulses.
            price_valid <= 0;
            line_error  <= 0;

            if (data_valid) begin
                // If CR ended the previous line, ignore one LF.
                if (skip_lf && data_in == ASCII_LF) begin
                    skip_lf <= 0;
                end else begin
                    skip_lf <= 0;

                    if (data_in >= ASCII_ZERO &&
                        data_in <= ASCII_NINE) begin

                        // Check decimal overflow before accepting digit.
                        if (!line_invalid &&
                            digit_count < MAX_DIGITS &&
                            accumulator <=
                            (32'hFFFFFFFF - digit_value) / 10) begin

                            accumulator <= next_value;
                            digit_count <= digit_count + 1'b1;
                        end else begin
                            line_invalid <= 1;
                        end

                    end else if (data_in == ASCII_CR ||
                                 data_in == ASCII_LF) begin

                        if (!line_invalid && digit_count != 0) begin
                            price       <= accumulator;
                            price_valid <= 1;
                        end else begin
                            line_error <= 1;
                        end

                        accumulator  <= 0;
                        digit_count  <= 0;
                        line_invalid <= 0;

                        if (data_in == ASCII_CR)
                            skip_lf <= 1;

                    end else begin
                        line_invalid <= 1;
                    end
                end
            end
        end
    end

endmodule
