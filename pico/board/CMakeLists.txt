# The Mind-Controlled Light Switch for a Raspberry Pi Pico 2 W.
#
#   cmake -S . -B build -DPICO_SDK_PATH=/path/to/pico-sdk
#   cmake --build build
#
# The file to drag onto the board is build/light-switch-pico-2-w.uf2.

cmake_minimum_required(VERSION 3.13)
set(PICO_BOARD pico2_w CACHE STRING "Board type")
include(pico_sdk_import.cmake)
project(light_switch_pico_2_w C CXX ASM)
set(CMAKE_C_STANDARD 11)
pico_sdk_init()

add_executable(light-switch-pico-2-w main.c)
target_include_directories(light-switch-pico-2-w PRIVATE ${CMAKE_CURRENT_LIST_DIR})
target_link_libraries(light-switch-pico-2-w
    pico_stdlib
    pico_btstack_ble
    pico_btstack_cyw43
    pico_cyw43_arch_none
)
# Messages go out over USB, for anyone watching with a serial monitor.
pico_enable_stdio_usb(light-switch-pico-2-w 1)
pico_enable_stdio_uart(light-switch-pico-2-w 0)
pico_add_extra_outputs(light-switch-pico-2-w)
