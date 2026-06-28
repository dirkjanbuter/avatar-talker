<?php
/**
 * Plugin Name:  Avatar Talker
 * Description:  Talking 3D avatar powered by x.ai — WebGL avatar with lip-sync visemes,
 *               speech-to-text input, Grok AI responses, and text-to-speech output.
 *               All x.ai API calls proxied server-side; key never exposed to browser.
 * Version:      1.0.0
 * Author:       Avatar Talker
 * License:      GPL-2.0+
 */
if ( ! defined( 'ABSPATH' ) ) exit;

define( 'AT_VERSION', '1.0.0' );
define( 'AT_DIR',     plugin_dir_path( __FILE__ ) );
define( 'AT_URL',     plugin_dir_url( __FILE__ ) );

/* ── Activation ── */
register_activation_hook( __FILE__, function () {
    global $wpdb;
    $t  = $wpdb->prefix . 'at_conversations';
    $cs = $wpdb->get_charset_collate();
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta( "CREATE TABLE IF NOT EXISTS $t (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        session_id  VARCHAR(64)     NOT NULL,
        role        VARCHAR(16)     NOT NULL,
        content     TEXT            NOT NULL,
        created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY session_id (session_id)
    ) $cs;" );
} );

/* ── Default options ── */
function at_defaults() {
    return [
        'xai_api_key'    => '',
        'chat_model'     => 'grok-3',
        'tts_voice'      => 'eve',
        'system_prompt'  => 'You are a friendly and helpful AI assistant. Keep your answers concise and conversational — aim for 2-3 sentences. You are represented by a realistic 3D avatar.',
        'avatar_name'    => 'Aria',
        'language'       => 'en',
        'max_history'    => 10,
    ];
}

/* ── Admin menu ── */
add_action( 'admin_menu', function () {
    add_menu_page( 'Avatar Talker', 'Avatar Talker', 'manage_options',
        'avatar-talker', 'at_admin_page', 'dashicons-format-audio', 55 );
} );

function at_admin_page() {
    if ( isset( $_POST['at_nonce'] ) && wp_verify_nonce( $_POST['at_nonce'], 'at_save' ) ) {
        $fields = [ 'xai_api_key','chat_model','tts_voice','system_prompt',
                    'avatar_name','language','max_history' ];
        foreach ( $fields as $f ) {
            $val = $f === 'system_prompt'
                ? sanitize_textarea_field( wp_unslash( $_POST[ $f ] ?? '' ) )
                : sanitize_text_field( wp_unslash( $_POST[ $f ] ?? '' ) );
            update_option( 'at_' . $f, $val );
        }
        echo '<div class="updated"><p>✅ Settings saved.</p></div>';
    }

    $d = at_defaults();
    $get = fn($k) => get_option( 'at_' . $k, $d[$k] );

    $models = [
        'grok-3'          => 'Grok 3 (recommended)',
        'grok-3-mini'     => 'Grok 3 Mini (faster)',
        'grok-2'          => 'Grok 2',
        'grok-2-mini'     => 'Grok 2 Mini',
    ];
    $voices = [
        'eve' => 'Eve (energetic)',
        'ara' => 'Ara (warm)',
        'rex' => 'Rex (confident)',
        'sal' => 'Sal (balanced)',
        'leo' => 'Leo (authoritative)',
    ];
    $langs = [
        'en'=>'English','nl'=>'Dutch','de'=>'German','fr'=>'French',
        'es'=>'Spanish','it'=>'Italian','pt'=>'Portuguese','ja'=>'Japanese',
        'ko'=>'Korean','zh'=>'Chinese','ar'=>'Arabic','ru'=>'Russian',
    ];
    ?>
    <div class="wrap">
    <h1>🎙️ Avatar Talker — Settings</h1>
    <p>Shortcode: <code>[avatar_talker]</code> &nbsp;|&nbsp; Optional height: <code>[avatar_talker height="700px"]</code></p>

    <form method="post">
    <?php wp_nonce_field('at_save','at_nonce'); ?>
    <table class="form-table">

      <tr><th>x.ai API Key</th><td>
        <input type="password" name="xai_api_key" value="<?php echo esc_attr($get('xai_api_key')); ?>"
          class="regular-text" placeholder="xai-...">
        <p class="description">Get your key at <a href="https://console.x.ai" target="_blank">console.x.ai</a>. Never exposed to the browser — all API calls go through this server.</p>
      </td></tr>

      <tr><th>Avatar Name</th><td>
        <input type="text" name="avatar_name" value="<?php echo esc_attr($get('avatar_name')); ?>" class="regular-text">
        <p class="description">Displayed in the UI and used in the system prompt.</p>
      </td></tr>

      <tr><th>Chat Model</th><td>
        <select name="chat_model">
          <?php foreach ( $models as $val => $label ): ?>
            <option value="<?php echo esc_attr($val); ?>" <?php selected($get('chat_model'), $val); ?>>
              <?php echo esc_html($label); ?>
            </option>
          <?php endforeach; ?>
        </select>
      </td></tr>

      <tr><th>TTS Voice</th><td>
        <select name="tts_voice">
          <?php foreach ( $voices as $val => $label ): ?>
            <option value="<?php echo esc_attr($val); ?>" <?php selected($get('tts_voice'), $val); ?>>
              <?php echo esc_html($label); ?>
            </option>
          <?php endforeach; ?>
        </select>
      </td></tr>

      <tr><th>Language</th><td>
        <select name="language">
          <?php foreach ( $langs as $val => $label ): ?>
            <option value="<?php echo esc_attr($val); ?>" <?php selected($get('language'), $val); ?>>
              <?php echo esc_html($label); ?>
            </option>
          <?php endforeach; ?>
        </select>
        <p class="description">Used for both speech recognition and TTS output.</p>
      </td></tr>

      <tr><th>System Prompt</th><td>
        <textarea name="system_prompt" rows="8" class="large-text"><?php
          echo esc_textarea($get('system_prompt'));
        ?></textarea>
        <p class="description">
          Defines the avatar's personality and knowledge. You can reference the avatar name with <code>{name}</code>.
          <br>Example: <em>You are {name}, a knowledgeable financial advisor. Always be professional and concise.</em>
        </p>
      </td></tr>

      <tr><th>Conversation Memory</th><td>
        <input type="number" name="max_history" value="<?php echo esc_attr($get('max_history')); ?>"
          min="2" max="50" style="width:80px"> messages
        <p class="description">How many previous messages to send as context (per session). Higher = more memory, more tokens.</p>
      </td></tr>

    </table>
    <?php submit_button( 'Save Settings' ); ?>
    </form>

    <hr>
    <h2>How it works</h2>
    <ol>
      <li>User clicks 🎤 and speaks → browser records audio via MediaRecorder</li>
      <li>Audio blob → WordPress AJAX → x.ai STT API → transcript text</li>
      <li>Transcript + history → x.ai Chat API (your model + system prompt) → response text</li>
      <li>Response text → x.ai TTS API → MP3 audio → sent back to browser</li>
      <li>Browser decodes MP3 with Web Audio API → amplitude drives avatar viseme morphs in real-time</li>
      <li>Avatar lip-syncs: jaw, mouth, viseme ARKit shapes animated on the real GLB mesh</li>
    </ol>
    <p><strong>All x.ai API calls are made from this WordPress server — your API key is never sent to the browser.</strong></p>
    </div>
    <?php
}

/* ── Shortcode ── */
add_shortcode( 'avatar_talker', function ( $atts ) {
    $a = shortcode_atts( [ 'height' => '680px' ], $atts );
    $name = get_option( 'at_avatar_name', at_defaults()['avatar_name'] );
    return '<div id="at-root" style="height:' . esc_attr($a['height']) . '"
        data-name="' . esc_attr($name) . '"
        data-nonce="' . wp_create_nonce('at_nonce') . '"></div>';
} );

/* ── Enqueue assets ── */
add_action( 'wp_enqueue_scripts', function () {
    global $post;
    if ( ! is_a($post,'WP_Post') || ! has_shortcode($post->post_content,'avatar_talker') ) return;

    $v = AT_VERSION;
    wp_enqueue_script( 'three',       'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', [], 'r128', true );
    wp_enqueue_script( 'three-orbit', AT_URL.'public/js/OrbitControls.js',  ['three'], $v, true );
    wp_enqueue_script( 'three-draco', AT_URL.'public/js/DRACOLoader.js',    ['three'], $v, true );
    wp_enqueue_script( 'three-gltf',  AT_URL.'public/js/GLTFLoader.js',     ['three','three-draco'], $v, true );
    wp_enqueue_script( 'at-app',      AT_URL.'public/js/avatar-talker.js',  ['three','three-orbit','three-gltf'], $v, true );
    wp_enqueue_style(  'at-style',    AT_URL.'public/css/avatar-talker.css', [], $v );

    wp_localize_script( 'at-app', 'AT_CFG', [
        'ajax'       => admin_url('admin-ajax.php'),
        'nonce'      => wp_create_nonce('at_nonce'),
        'avatar_url' => AT_URL . 'public/assets/avatar.glb',
        'avatar_name'=> get_option('at_avatar_name', at_defaults()['avatar_name']),
        'language'   => get_option('at_language',    at_defaults()['language']),
    ] );
} );

/* ════════════════════════════════════════════════
   AJAX ENDPOINTS  (all API calls server-side)
════════════════════════════════════════════════ */

/* ── 1. STT: audio blob → transcript ── */
add_action( 'wp_ajax_at_stt',        'at_ajax_stt' );
add_action( 'wp_ajax_nopriv_at_stt', 'at_ajax_stt' );
function at_ajax_stt() {
    check_ajax_referer( 'at_nonce', 'nonce' );

    $key = get_option('at_xai_api_key','');
    if ( ! $key ) { wp_send_json_error('API key not configured'); return; }

    if ( empty($_FILES['audio']) || $_FILES['audio']['error'] !== UPLOAD_ERR_OK ) {
        wp_send_json_error('No audio received'); return;
    }

    $tmp  = $_FILES['audio']['tmp_name'];
    $lang = get_option('at_language', at_defaults()['language']);

    // Build multipart request to x.ai STT
    $boundary = wp_generate_uuid4();
    $body     = '';
    // language field
    $body .= "--{$boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\n{$lang}\r\n";
    // format field (enable inverse text normalisation)
    $body .= "--{$boundary}\r\nContent-Disposition: form-data; name=\"format\"\r\n\r\ntrue\r\n";
    // audio file
    $audio_data = file_get_contents($tmp);
    $body .= "--{$boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.webm\"\r\nContent-Type: audio/webm\r\n\r\n{$audio_data}\r\n";
    $body .= "--{$boundary}--\r\n";

    $response = wp_remote_post( 'https://api.x.ai/v1/stt', [
        'timeout' => 30,
        'headers' => [
            'Authorization' => 'Bearer ' . $key,
            'Content-Type'  => 'multipart/form-data; boundary=' . $boundary,
        ],
        'body' => $body,
    ] );

    if ( is_wp_error($response) ) {
        wp_send_json_error( $response->get_error_message() ); return;
    }

    $data = json_decode( wp_remote_retrieve_body($response), true );
    $text = $data['text'] ?? '';

    if ( empty($text) ) {
        wp_send_json_error('No transcript returned'); return;
    }

    wp_send_json_success( [ 'transcript' => trim($text) ] );
}

/* ── 2. CHAT: transcript → Grok response ── */
add_action( 'wp_ajax_at_chat',        'at_ajax_chat' );
add_action( 'wp_ajax_nopriv_at_chat', 'at_ajax_chat' );
function at_ajax_chat() {
    check_ajax_referer( 'at_nonce', 'nonce' );

    $key = get_option('at_xai_api_key','');
    if ( ! $key ) { wp_send_json_error('API key not configured'); return; }

    $user_text = sanitize_text_field( wp_unslash( $_POST['message'] ?? '' ) );
    $history   = json_decode( wp_unslash( $_POST['history'] ?? '[]' ), true );
    if ( ! is_array($history) ) $history = [];

    $d       = at_defaults();
    $model   = get_option('at_chat_model',   $d['chat_model']);
    $name    = get_option('at_avatar_name',  $d['avatar_name']);
    $prompt  = get_option('at_system_prompt',$d['system_prompt']);
    $max_h   = intval( get_option('at_max_history', $d['max_history']) );

    // Replace {name} placeholder
    $prompt = str_replace( '{name}', $name, $prompt );

    // Build messages array
    $messages = [ [ 'role' => 'system', 'content' => $prompt ] ];

    // Append trimmed history
    $history = array_slice( $history, -($max_h * 2) );
    foreach ( $history as $h ) {
        if ( isset($h['role'], $h['content']) ) {
            $messages[] = [
                'role'    => in_array($h['role'],['user','assistant']) ? $h['role'] : 'user',
                'content' => substr( sanitize_textarea_field($h['content']), 0, 2000 ),
            ];
        }
    }
    $messages[] = [ 'role' => 'user', 'content' => $user_text ];

    $response = wp_remote_post( 'https://api.x.ai/v1/chat/completions', [
        'timeout' => 45,
        'headers' => [
            'Authorization' => 'Bearer ' . $key,
            'Content-Type'  => 'application/json',
        ],
        'body' => wp_json_encode( [
            'model'       => $model,
            'messages'    => $messages,
            'max_tokens'  => 300,
            'temperature' => 0.7,
        ] ),
    ] );

    if ( is_wp_error($response) ) {
        wp_send_json_error( $response->get_error_message() ); return;
    }

    $data   = json_decode( wp_remote_retrieve_body($response), true );
    $reply  = $data['choices'][0]['message']['content'] ?? '';

    if ( empty($reply) ) {
        $err = $data['error']['message'] ?? 'No response from model';
        wp_send_json_error($err); return;
    }

    wp_send_json_success( [ 'reply' => trim($reply) ] );
}

/* ── 3. TTS: text → MP3 base64 ── */
add_action( 'wp_ajax_at_tts',        'at_ajax_tts' );
add_action( 'wp_ajax_nopriv_at_tts', 'at_ajax_tts' );
function at_ajax_tts() {
    check_ajax_referer( 'at_nonce', 'nonce' );

    $key = get_option('at_xai_api_key','');
    if ( ! $key ) { wp_send_json_error('API key not configured'); return; }

    $text  = sanitize_textarea_field( wp_unslash( $_POST['text'] ?? '' ) );
    $voice = get_option('at_tts_voice', at_defaults()['tts_voice']);
    $lang  = get_option('at_language',  at_defaults()['language']);

    if ( empty($text) ) { wp_send_json_error('No text'); return; }

    // Truncate to 2000 chars for safety (x.ai limit is 15k but keep it snappy)
    $text = mb_substr( $text, 0, 2000 );

    $response = wp_remote_post( 'https://api.x.ai/v1/tts', [
        'timeout' => 45,
        'headers' => [
            'Authorization' => 'Bearer ' . $key,
            'Content-Type'  => 'application/json',
        ],
        'body' => wp_json_encode( [
            'text'     => $text,
            'voice_id' => $voice,
            'language' => $lang,
        ] ),
    ] );

    if ( is_wp_error($response) ) {
        wp_send_json_error( $response->get_error_message() ); return;
    }

    $code = wp_remote_retrieve_response_code($response);
    if ( $code !== 200 ) {
        $body = wp_remote_retrieve_body($response);
        $err  = json_decode($body,true)['error']['message'] ?? "TTS error {$code}";
        wp_send_json_error($err); return;
    }

    // Return audio as base64 so JS can decode it
    $audio_data = wp_remote_retrieve_body($response);
    wp_send_json_success( [
        'audio' => base64_encode($audio_data),
        'mime'  => 'audio/mpeg',
    ] );
}