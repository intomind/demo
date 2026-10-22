// Bluetooth settings for the board program: Low Energy only, as a central
// that pairs with LE Secure Connections and keeps its pairings in flash.
// The values follow Raspberry Pi's own examples for this board.

#ifndef BTSTACK_CONFIG_H
#define BTSTACK_CONFIG_H

// ENABLE_BLE is set by the pico_btstack_ble library.
#define ENABLE_LE_CENTRAL
#define ENABLE_LE_SECURE_CONNECTIONS
#define ENABLE_MICRO_ECC_FOR_LE_SECURE_CONNECTIONS
#define ENABLE_SOFTWARE_AES128
#define ENABLE_GATT_CLIENT_PAIRING
#define ENABLE_LE_DATA_LENGTH_EXTENSION
#define ENABLE_LE_PRIVACY_ADDRESS_RESOLUTION
#define ENABLE_LE_ENHANCED_CONNECTION_COMPLETE_EVENT
#define ENABLE_LOG_ERROR
#define ENABLE_PRINTF_HEXDUMP

// Buffers and sizes.
#define HCI_OUTGOING_PRE_BUFFER_SIZE 4
#define HCI_ACL_PAYLOAD_SIZE (1691 + 4)
#define HCI_ACL_CHUNK_SIZE_ALIGNMENT 4
#define MAX_NR_GATT_CLIENTS 1
#define MAX_NR_HCI_CONNECTIONS 2
#define MAX_NR_L2CAP_CHANNELS 4
#define MAX_NR_L2CAP_SERVICES 3
#define MAX_NR_SM_LOOKUP_ENTRIES 3
#define MAX_NR_WHITELIST_ENTRIES 16
#define MAX_NR_LE_DEVICE_DB_ENTRIES 16

// Limit the controller's buffers, and let it pace the host, so the shared bus to the wireless chip never overruns.
#define MAX_NR_CONTROLLER_ACL_BUFFERS 3
#define MAX_NR_CONTROLLER_SCO_PACKETS 3
#define ENABLE_HCI_CONTROLLER_TO_HOST_FLOW_CONTROL
#define HCI_HOST_ACL_PACKET_LEN 1024
#define HCI_HOST_ACL_PACKET_NUM 3
#define HCI_HOST_SCO_PACKET_LEN 120
#define HCI_HOST_SCO_PACKET_NUM 3

// Pairings kept in flash.
#define NVM_NUM_DEVICE_DB_ENTRIES 16
#define NVM_NUM_LINK_KEYS 16

// No heap for BTstack: a fixed-size, empty attribute database.
#define MAX_ATT_DB_SIZE 512

#define HAVE_EMBEDDED_TIME_MS
#define HAVE_ASSERT
#define HCI_RESET_RESEND_TIMEOUT_MS 1000

#endif
