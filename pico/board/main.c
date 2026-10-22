// The Mind-Controlled Light Switch, on a Raspberry Pi Pico 2 W.
//
// The board finds an IntoMind One over Bluetooth, pairs with it once and
// remembers it, asks it to run the custom AI head taught on the
// Mind-Controlled Light Switch demo, and follows every reading: the LED turns
// on while the custom AI head reads On. Nothing else is needed once this is
// on the board, and no computer is involved.
//
// To drive a pin for a project of your own, a circuit, a robot, anything,
// see "Your code goes here" below: the code for a pin is there, commented
// out, ready to use.
//
// What the LED says:
//
//   one short blink a second      looking for your IntoMind One
//   two short blinks a second     your IntoMind One is on its charger, and
//                                 sends no EEG until it is off it
//   three short blinks a second   no custom AI head is installed on it yet
//   off                           your custom AI head reads Off
//   on                            your custom AI head reads On
//   fast blinking                 the last reading had a gap in the signal,
//                                 or an electrode had lost the skin
//
// The protocol is the one the published IntoMind SDK documents: a service,
// a control point that answers every command on its own characteristic,
// and a stream of predictions.
//
// Copyright (C) 2026 IntoMind, Inc.
//
// This program is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3. It is distributed in the hope
// that it will be useful, but WITHOUT ANY WARRANTY, without even the
// implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
// See the GNU Affero General Public License for more details.
//
// Additional permission under GNU AGPL version 3 section 7: if you modify
// this program, or any covered work, by linking or combining it with the
// Raspberry Pi Pico SDK, BTstack, or the cyw43 driver and its firmware (or
// modified versions of them), containing parts covered by the terms of
// their own licenses, IntoMind, Inc. grants you additional permission to
// convey the resulting work.

#include <stdio.h>
#include <string.h>

#include "btstack.h"
#include "hardware/gpio.h"
#include "pico/cyw43_arch.h"
#include "pico/stdlib.h"

// ---- Settings you might change. ----

/** Where the Mind-Controlled Light Switch demo installs your custom AI head. */
#define HEAD_SLOT 2
/** A reading above this means On, the same line the demo draws. */
#define SWITCH_THRESHOLD 0.5f
/** A pin to switch, for the commented-out code below: GP15 is the board's pin 20, with ground on pin 18. */
#define SWITCH_PIN 15
/** Part of a name, like "Ada's", to choose one IntoMind One among several. Empty takes the first one found. */
#define DEVICE_NAME_PREFIX ""

// ---- Your code goes here. ----

/** Called once, when the board starts. Set up whatever you will switch. */
static void on_start(void) {
    // To drive a pin, uncomment these three lines and the one in on_switch.
    // The pin goes high, to 3.3 V, while the custom AI head reads On: a
    // signal any circuit, robot or project of your own can act on.
    // gpio_init(SWITCH_PIN);
    // gpio_set_dir(SWITCH_PIN, GPIO_OUT);
    // gpio_put(SWITCH_PIN, 0);
}

/**
 * Called whenever your custom AI head's decision changes: true when it
 * reads On, false when it reads Off, and false when the link to your
 * IntoMind One is lost. The board's own LED already follows it.
 */
static void on_switch(bool on) {
    (void) on;
    // gpio_put(SWITCH_PIN, on);
}

/**
 * Called for every reading, every few seconds: the custom AI head's score, from 0 to
 * 1, and whether the signal behind it was clean. For anything finer than
 * on and off.
 */
static void on_reading(float score, bool clean) {
    (void) score;
    (void) clean;
}

// ---- The IntoMind protocol. ----

/** The service every IntoMind One advertises, f3a10001-2c4b-4d1e-9a6f-1b2c3d4e5f60, most significant byte first. */
static const uint8_t SERVICE_UUID[16] = {0xf3, 0xa1, 0x00, 0x01, 0x2c, 0x4b, 0x4d, 0x1e, 0x9a, 0x6f, 0x1b, 0x2c, 0x3d, 0x4e, 0x5f, 0x60};
/** Each characteristic shares the service's identifier except for these two bytes. */
#define FILL_CONTROL 0x0003
#define FILL_CONTROL_RESPONSE 0x0004
#define FILL_PREDICTIONS 0x000a

#define OP_START_STREAM 0x01
#define OP_SET_PREDICTIONS 0x80
#define OP_SELECT_HEAD 0x81
#define STATUS_OK 0
/** Start stream turned away because the device already streams. */
#define STATUS_BUSY 3
/** Start stream refused: the device is on USB power. */
#define STATUS_USB_POWER 7

#define PACKET_PREDICTION 0x02
#define PREDICTION_HEADER_LEN 28
#define FLAG_GAP_IN_WINDOW 0x01
#define FLAG_LEADOFF_IN_WINDOW 0x04

/** How long to wait for an answer, for a connection, and for a reading, in milliseconds. */
#define ANSWER_TIMEOUT_MS 5000
#define CONNECT_TIMEOUT_MS 10000
#define READING_TIMEOUT_MS 20000
/** How long to wait before asking again while the device charges, or has no head. */
#define RETRY_MS 5000

// ---- What the board is doing, and what the LED shows. ----

typedef enum {
    LINK_OFF,
    LINK_LOOKING,
    LINK_CONNECTING,
    LINK_SECURING,
    LINK_FINDING_SERVICE,
    LINK_FINDING_CHARACTERISTICS,
    LINK_SUBSCRIBING_ANSWERS,
    LINK_SUBSCRIBING_READINGS,
    LINK_COMMANDING,
    LINK_RUNNING,
} link_t;

typedef enum {
    SHOW_LOOKING,
    SHOW_CHARGING,
    SHOW_NO_HEAD,
    SHOW_OFF,
    SHOW_ON,
    SHOW_SIGNAL,
} show_t;

static link_t link_state = LINK_OFF;
static show_t show = SHOW_LOOKING;
static bool decided_on = false;

static hci_con_handle_t con_handle = HCI_CON_HANDLE_INVALID;
static gatt_client_service_t service;
static gatt_client_characteristic_t control, answers, readings;
static bool have_control, have_answers, have_readings;
static gatt_client_notification_t answers_listener, readings_listener;
static bool listening;

/** The commands, in order, and where the board is in them. */
static const uint8_t COMMANDS[][2] = {{OP_SELECT_HEAD, HEAD_SLOT}, {OP_START_STREAM, 0}, {OP_SET_PREDICTIONS, 1}};
static const uint8_t COMMAND_LENGTHS[] = {2, 1, 2};
static int command_at = 0;
static uint8_t command_buffer[2];

static btstack_packet_callback_registration_t hci_registration, sm_registration;
static btstack_timer_source_t led_timer, step_timer;

/** Devices that advertised the service, for when a name has to be matched from a separate scan response. */
#define CANDIDATES 8
static bd_addr_t candidates[CANDIDATES];
static int candidate_count = 0;

// ---- The switch. ----

static void set_switch(bool on) {
    if (on == decided_on) return;
    decided_on = on;
    on_switch(on);
}

// ---- The LED: a pattern for each state, drawn every 50 ms. ----

static void led_tick(btstack_timer_source_t *ts) {
    uint32_t ms = btstack_run_loop_get_time_ms() % 1000;
    bool lit = false;
    switch (show) {
        case SHOW_LOOKING:  lit = ms < 100; break;
        case SHOW_CHARGING: lit = ms < 100 || (ms >= 250 && ms < 350); break;
        case SHOW_NO_HEAD:  lit = ms < 100 || (ms >= 250 && ms < 350) || (ms >= 500 && ms < 600); break;
        case SHOW_OFF:      lit = false; break;
        case SHOW_ON:       lit = true; break;
        case SHOW_SIGNAL:   lit = (ms / 100) % 2 == 0; break;
    }
    cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, lit);
    btstack_run_loop_set_timer(ts, 50);
    btstack_run_loop_add_timer(ts);
}

// ---- One timer for every step that can stall, or has to wait. ----

static void after(uint32_t ms, void (*then)(btstack_timer_source_t *)) {
    btstack_run_loop_remove_timer(&step_timer);
    btstack_run_loop_set_timer_handler(&step_timer, then);
    btstack_run_loop_set_timer(&step_timer, ms);
    btstack_run_loop_add_timer(&step_timer);
}

static void cancel_step(void) {
    btstack_run_loop_remove_timer(&step_timer);
}

static void start_looking(void);
static void send_command(void);

static void give_up(btstack_timer_source_t *ts) {
    (void) ts;
    printf("No answer in time, starting over.\n");
    if (link_state == LINK_CONNECTING) {
        gap_connect_cancel();
        start_looking();
    } else if (con_handle != HCI_CON_HANDLE_INVALID) {
        gap_disconnect(con_handle);
    } else {
        start_looking();
    }
}

static void retry_command(btstack_timer_source_t *ts) {
    (void) ts;
    send_command();
}

// ---- Finding the device. ----

static void start_looking(void) {
    link_state = LINK_LOOKING;
    show = SHOW_LOOKING;
    candidate_count = 0;
    cancel_step();
    printf("Looking for an IntoMind One.\n");
    gap_set_scan_parameters(1, 0x0030, 0x0030);
    gap_start_scan();
}

static bool name_matches(const uint8_t *data, uint8_t length) {
    const char *prefix = DEVICE_NAME_PREFIX;
    size_t want = strlen(prefix);
    ad_context_t context;
    for (ad_iterator_init(&context, length, data); ad_iterator_has_more(&context); ad_iterator_next(&context)) {
        uint8_t type = ad_iterator_get_data_type(&context);
        if (type != BLUETOOTH_DATA_TYPE_COMPLETE_LOCAL_NAME && type != BLUETOOTH_DATA_TYPE_SHORTENED_LOCAL_NAME) continue;
        const uint8_t *name = ad_iterator_get_data(&context);
        uint8_t name_length = ad_iterator_get_data_len(&context);
        if (name_length >= want && memcmp(name, prefix, want) == 0) return true;
    }
    return false;
}

static bool is_candidate(bd_addr_t address) {
    for (int i = 0; i < candidate_count; i++) if (bd_addr_cmp(candidates[i], address) == 0) return true;
    return false;
}

static void connect_to(bd_addr_t address, bd_addr_type_t type) {
    gap_stop_scan();
    link_state = LINK_CONNECTING;
    printf("Found an IntoMind One at %s, connecting.\n", bd_addr_to_str(address));
    gap_connect(address, type);
    after(CONNECT_TIMEOUT_MS, give_up);
}

static void on_advertisement(const uint8_t *packet) {
    bd_addr_t address;
    gap_event_advertising_report_get_address(packet, address);
    bd_addr_type_t type = (bd_addr_type_t) gap_event_advertising_report_get_address_type(packet);
    uint8_t length = gap_event_advertising_report_get_data_length(packet);
    const uint8_t *data = gap_event_advertising_report_get_data(packet);
    bool advertises_service = ad_data_contains_uuid128(length, data, SERVICE_UUID);
    if (strlen(DEVICE_NAME_PREFIX) == 0) {
        if (advertises_service) connect_to(address, type);
        return;
    }
    // A name may come in the scan response, apart from the service: remember who advertised the service.
    if (advertises_service && !is_candidate(address) && candidate_count < CANDIDATES) {
        bd_addr_copy(candidates[candidate_count++], address);
    }
    if (is_candidate(address) && name_matches(data, length)) connect_to(address, type);
}

// ---- After pairing: find the characteristics, subscribe, then send the commands. ----

static bool is_fill(const uint8_t *uuid128, uint16_t fill) {
    return memcmp(uuid128, SERVICE_UUID, 2) == 0 && uuid128[2] == (fill >> 8) && uuid128[3] == (fill & 0xff)
        && memcmp(uuid128 + 4, SERVICE_UUID + 4, 12) == 0;
}

static uint16_t configuration_for(const gatt_client_characteristic_t *c) {
    return (c->properties & ATT_PROPERTY_INDICATE) ? GATT_CLIENT_CHARACTERISTICS_CONFIGURATION_INDICATION
                                                   : GATT_CLIENT_CHARACTERISTICS_CONFIGURATION_NOTIFICATION;
}

static void on_value(uint16_t value_handle, const uint8_t *value, uint16_t length);
static void gatt_handler(uint8_t packet_type, uint16_t channel, uint8_t *packet, uint16_t size);

static void find_service(void) {
    link_state = LINK_FINDING_SERVICE;
    have_control = have_answers = have_readings = false;
    gatt_client_discover_primary_services_by_uuid128(gatt_handler, con_handle, SERVICE_UUID);
    after(ANSWER_TIMEOUT_MS, give_up);
}

static void send_command(void) {
    link_state = LINK_COMMANDING;
    memcpy(command_buffer, COMMANDS[command_at], 2);
    printf("Command 0x%02x.\n", command_buffer[0]);
    gatt_client_write_value_of_characteristic(gatt_handler, con_handle, control.value_handle, COMMAND_LENGTHS[command_at], command_buffer);
    after(ANSWER_TIMEOUT_MS, give_up);
}

static void gatt_handler(uint8_t packet_type, uint16_t channel, uint8_t *packet, uint16_t size) {
    (void) channel;
    (void) size;
    if (packet_type != HCI_EVENT_PACKET) return;
    uint8_t event = hci_event_packet_get_type(packet);

    if (event == GATT_EVENT_NOTIFICATION) {
        on_value(gatt_event_notification_get_value_handle(packet), gatt_event_notification_get_value(packet), gatt_event_notification_get_value_length(packet));
        return;
    }
    if (event == GATT_EVENT_INDICATION) {
        on_value(gatt_event_indication_get_value_handle(packet), gatt_event_indication_get_value(packet), gatt_event_indication_get_value_length(packet));
        return;
    }

    switch (link_state) {
        case LINK_FINDING_SERVICE:
            if (event == GATT_EVENT_SERVICE_QUERY_RESULT) {
                gatt_event_service_query_result_get_service(packet, &service);
            } else if (event == GATT_EVENT_QUERY_COMPLETE) {
                if (gatt_event_query_complete_get_att_status(packet) != ATT_ERROR_SUCCESS) { gap_disconnect(con_handle); break; }
                link_state = LINK_FINDING_CHARACTERISTICS;
                gatt_client_discover_characteristics_for_service(gatt_handler, con_handle, &service);
                after(ANSWER_TIMEOUT_MS, give_up);
            }
            break;
        case LINK_FINDING_CHARACTERISTICS:
            if (event == GATT_EVENT_CHARACTERISTIC_QUERY_RESULT) {
                gatt_client_characteristic_t c;
                gatt_event_characteristic_query_result_get_characteristic(packet, &c);
                if (is_fill(c.uuid128, FILL_CONTROL)) { control = c; have_control = true; }
                if (is_fill(c.uuid128, FILL_CONTROL_RESPONSE)) { answers = c; have_answers = true; }
                if (is_fill(c.uuid128, FILL_PREDICTIONS)) { readings = c; have_readings = true; }
            } else if (event == GATT_EVENT_QUERY_COMPLETE) {
                if (!(have_control && have_answers && have_readings)) {
                    printf("This device has no predictions to offer.\n");
                    gap_disconnect(con_handle);
                    break;
                }
                gatt_client_listen_for_characteristic_value_updates(&answers_listener, gatt_handler, con_handle, &answers);
                gatt_client_listen_for_characteristic_value_updates(&readings_listener, gatt_handler, con_handle, &readings);
                listening = true;
                link_state = LINK_SUBSCRIBING_ANSWERS;
                gatt_client_write_client_characteristic_configuration(gatt_handler, con_handle, &answers, configuration_for(&answers));
                after(ANSWER_TIMEOUT_MS, give_up);
            }
            break;
        case LINK_SUBSCRIBING_ANSWERS:
            if (event == GATT_EVENT_QUERY_COMPLETE) {
                if (gatt_event_query_complete_get_att_status(packet) != ATT_ERROR_SUCCESS) { gap_disconnect(con_handle); break; }
                link_state = LINK_SUBSCRIBING_READINGS;
                gatt_client_write_client_characteristic_configuration(gatt_handler, con_handle, &readings, configuration_for(&readings));
                after(ANSWER_TIMEOUT_MS, give_up);
            }
            break;
        case LINK_SUBSCRIBING_READINGS:
            if (event == GATT_EVENT_QUERY_COMPLETE) {
                if (gatt_event_query_complete_get_att_status(packet) != ATT_ERROR_SUCCESS) { gap_disconnect(con_handle); break; }
                command_at = 0;
                send_command();
            }
            break;
        case LINK_COMMANDING:
            // The write itself completing says nothing yet: the answer comes on its own characteristic.
            if (event == GATT_EVENT_QUERY_COMPLETE && gatt_event_query_complete_get_att_status(packet) != ATT_ERROR_SUCCESS) {
                gap_disconnect(con_handle);
            }
            break;
        default:
            break;
    }
}

/** An answer to a command, or a reading. */
static void on_value(uint16_t value_handle, const uint8_t *value, uint16_t length) {
    if (value_handle == answers.value_handle && length >= 2 && link_state == LINK_COMMANDING) {
        uint8_t opcode = value[0], status = value[1];
        if (opcode != COMMANDS[command_at][0]) return;
        cancel_step();
        if (status == STATUS_OK || (opcode == OP_START_STREAM && status == STATUS_BUSY)) {
            command_at++;
            if (command_at < (int) (sizeof COMMAND_LENGTHS)) { send_command(); return; }
            printf("Running your custom AI head.\n");
            link_state = LINK_RUNNING;
            show = SHOW_OFF;
            after(READING_TIMEOUT_MS, give_up);
            return;
        }
        if (opcode == OP_START_STREAM && status == STATUS_USB_POWER) {
            printf("Your IntoMind One is charging. Asking again shortly.\n");
            show = SHOW_CHARGING;
            after(RETRY_MS, retry_command);
            return;
        }
        if (opcode == OP_SELECT_HEAD) {
            printf("No custom AI head in slot %d (status %d). Asking again shortly.\n", HEAD_SLOT, status);
            show = SHOW_NO_HEAD;
            after(RETRY_MS, retry_command);
            return;
        }
        printf("Command 0x%02x refused with status %d.\n", opcode, status);
        gap_disconnect(con_handle);
        return;
    }
    if (value_handle == readings.value_handle && link_state == LINK_RUNNING) {
        if (length < PREDICTION_HEADER_LEN + 4 || value[0] != PACKET_PREDICTION || value[2] != HEAD_SLOT || value[3] < 1) return;
        float score;
        memcpy(&score, value + PREDICTION_HEADER_LEN, 4);
        bool clean = (value[1] & (FLAG_GAP_IN_WINDOW | FLAG_LEADOFF_IN_WINDOW)) == 0;
        after(READING_TIMEOUT_MS, give_up);
        on_reading(score, clean);
        if (clean) {
            set_switch(score > SWITCH_THRESHOLD);
            show = decided_on ? SHOW_ON : SHOW_OFF;
        } else {
            // A reading from a bad stretch of signal changes nothing. The LED says why.
            show = SHOW_SIGNAL;
        }
        printf("Reading %.2f%s\n", (double) score, clean ? "" : ", the signal had a gap or an electrode off");
    }
}

// ---- Bluetooth's own events: the chip coming up, advertisements, connections. ----

static void hci_handler(uint8_t packet_type, uint16_t channel, uint8_t *packet, uint16_t size) {
    (void) channel;
    (void) size;
    if (packet_type != HCI_EVENT_PACKET) return;
    switch (hci_event_packet_get_type(packet)) {
        case BTSTACK_EVENT_STATE:
            if (btstack_event_state_get_state(packet) == HCI_STATE_WORKING) start_looking();
            break;
        case GAP_EVENT_ADVERTISING_REPORT:
            if (link_state == LINK_LOOKING) on_advertisement(packet);
            break;
        case HCI_EVENT_META_GAP:
            if (hci_event_gap_meta_get_subevent_code(packet) != GAP_SUBEVENT_LE_CONNECTION_COMPLETE) break;
            if (link_state != LINK_CONNECTING) break;
            if (gap_subevent_le_connection_complete_get_status(packet) != ERROR_CODE_SUCCESS) { start_looking(); break; }
            con_handle = gap_subevent_le_connection_complete_get_connection_handle(packet);
            link_state = LINK_SECURING;
            printf("Connected. Securing the link.\n");
            // Pairs the first time, and re-encrypts with the stored keys every time after.
            sm_request_pairing(con_handle);
            after(CONNECT_TIMEOUT_MS * 2, give_up);
            break;
        case HCI_EVENT_DISCONNECTION_COMPLETE:
            con_handle = HCI_CON_HANDLE_INVALID;
            if (listening) {
                gatt_client_stop_listening_for_characteristic_value_updates(&answers_listener);
                gatt_client_stop_listening_for_characteristic_value_updates(&readings_listener);
                listening = false;
            }
            set_switch(false);
            printf("Disconnected.\n");
            start_looking();
            break;
        default:
            break;
    }
}

// ---- Pairing: Just Works, LE Secure Connections, kept in flash. ----

static void sm_handler(uint8_t packet_type, uint16_t channel, uint8_t *packet, uint16_t size) {
    (void) channel;
    (void) size;
    if (packet_type != HCI_EVENT_PACKET) return;
    bd_addr_t address;
    switch (hci_event_packet_get_type(packet)) {
        case SM_EVENT_JUST_WORKS_REQUEST:
            sm_just_works_confirm(sm_event_just_works_request_get_handle(packet));
            break;
        case SM_EVENT_NUMERIC_COMPARISON_REQUEST:
            sm_numeric_comparison_confirm(sm_event_numeric_comparison_request_get_handle(packet));
            break;
        case SM_EVENT_PAIRING_COMPLETE:
            if (sm_event_pairing_complete_get_status(packet) == ERROR_CODE_SUCCESS) {
                printf("Paired. The pairing is kept on the board.\n");
                if (link_state == LINK_SECURING) find_service();
            } else {
                printf("Pairing failed (status %d, reason %d).\n", sm_event_pairing_complete_get_status(packet), sm_event_pairing_complete_get_reason(packet));
                gap_disconnect(sm_event_pairing_complete_get_handle(packet));
            }
            break;
        case SM_EVENT_REENCRYPTION_COMPLETE:
            switch (sm_event_reencryption_complete_get_status(packet)) {
                case ERROR_CODE_SUCCESS:
                    printf("Secured with the stored pairing.\n");
                    if (link_state == LINK_SECURING) find_service();
                    break;
                case ERROR_CODE_PIN_OR_KEY_MISSING:
                    // The IntoMind One forgot this board. Forget it too, and pair afresh.
                    printf("The pairing was forgotten on the other side. Pairing again.\n");
                    sm_event_reencryption_complete_get_address(packet, address);
                    gap_delete_bonding((bd_addr_type_t) sm_event_reencryption_complete_get_addr_type(packet), address);
                    sm_request_pairing(sm_event_reencryption_complete_get_handle(packet));
                    break;
                default:
                    gap_disconnect(sm_event_reencryption_complete_get_handle(packet));
                    break;
            }
            break;
        default:
            break;
    }
}

int main(void) {
    stdio_init_all();
    if (cyw43_arch_init()) {
        printf("The wireless chip did not start.\n");
        return -1;
    }
    on_start();

    l2cap_init();
    sm_init();
    sm_set_io_capabilities(IO_CAPABILITY_NO_INPUT_NO_OUTPUT);
    sm_set_authentication_requirements(SM_AUTHREQ_SECURE_CONNECTION | SM_AUTHREQ_BONDING);
    // An empty attribute server, so the IntoMind One gets an answer if it asks this board anything.
    att_server_init(NULL, NULL, NULL);
    gatt_client_init();
    gatt_client_set_required_security_level(LEVEL_2);

    hci_registration.callback = &hci_handler;
    hci_add_event_handler(&hci_registration);
    sm_registration.callback = &sm_handler;
    sm_add_event_handler(&sm_registration);

    btstack_run_loop_set_timer_handler(&led_timer, led_tick);
    btstack_run_loop_set_timer(&led_timer, 50);
    btstack_run_loop_add_timer(&led_timer);

    hci_power_control(HCI_POWER_ON);
    btstack_run_loop_execute();
    return 0;
}
