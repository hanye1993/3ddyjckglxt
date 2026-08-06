<?php

class ApiClient
{
    private $base;
    private $key;

    public function __construct($base, $key)
    {
        $this->base = rtrim((string) $base, '/');
        $this->key = (string) $key;
    }

    public function get($path)
    {
        return $this->request('GET', $path);
    }

    public function post($path, $body = [])
    {
        return $this->request('POST', $path, $body);
    }

    public function getBinary($path)
    {
        $url = $this->base . $path;
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'X-Api-Key: ' . $this->key,
            ],
            CURLOPT_TIMEOUT => 30,
            CURLOPT_FOLLOWLOCATION => true,
        ]);
        $data = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($data === false) {
            throw new RuntimeException($err ?: '请求失败');
        }
        if ($code < 200 || $code >= 300) {
            throw new RuntimeException('HTTP ' . $code);
        }
        return ['body' => $data, 'contentType' => $ctype ?: 'image/jpeg'];
    }

    private function request($method, $path, $body = null)
    {
        $url = $this->base . $path;
        $ch = curl_init($url);
        $headers = ['X-Api-Key: ' . $this->key];
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_FOLLOWLOCATION => true,
        ];
        if ($method === 'POST') {
            $headers[] = 'Content-Type: application/json';
            $opts[CURLOPT_HTTPHEADER] = $headers;
            $opts[CURLOPT_POSTFIELDS] = json_encode($body === null ? new stdClass() : $body);
        }
        curl_setopt_array($ch, $opts);
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false) {
            throw new RuntimeException($err ?: '请求失败');
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new RuntimeException('无效 JSON 响应');
        }
        if ($code < 200 || $code >= 300 || (isset($data['ok']) && $data['ok'] === false)) {
            throw new RuntimeException(isset($data['message']) ? $data['message'] : ('HTTP ' . $code));
        }
        return $data;
    }
}

function hanye_config()
{
    $path = __DIR__ . '/../config.php';
    if (!is_file($path)) {
        return null;
    }
    $cfg = include $path;
    if (!is_array($cfg)) {
        return null;
    }
    return $cfg;
}

function hanye_client()
{
    $cfg = hanye_config();
    if (!$cfg) {
        throw new RuntimeException('请复制 config.sample.php 为 config.php 并填写 API_BASE / API_KEY');
    }
    return new ApiClient($cfg['API_BASE'], $cfg['API_KEY']);
}

function h($s)
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

function format_remain($sec)
{
    if ($sec === null || $sec === '' || !is_numeric($sec)) {
        return '--';
    }
    $sec = (int) $sec;
    if ($sec <= 0) {
        return '0m';
    }
    $m = (int) floor($sec / 60);
    $hh = (int) floor($m / 60);
    if ($hh > 0) {
        return $hh . 'h ' . ($m % 60) . 'm';
    }
    return $m . 'm';
}

function format_eta($sec)
{
    if ($sec === null || !is_numeric($sec) || (int) $sec <= 0) {
        return '--';
    }
    $eta = time() + (int) $sec;
    $t = date('H:i', $eta);
    $today = strtotime('today');
    $etaDay = strtotime(date('Y-m-d', $eta));
    $diff = (int) round(($etaDay - $today) / 86400);
    if ($diff <= 0) {
        return $t;
    }
    if ($diff === 1) {
        return '明天 ' . $t;
    }
    if ($diff === 2) {
        return '后天 ' . $t;
    }
    return date('n/j H:i', $eta);
}

function status_label($st)
{
    if (!$st || !is_array($st)) {
        return '未知';
    }
    $health = isset($st['health']) ? $st['health'] : '';
    if ($health === 'offline') {
        return '离线';
    }
    if ($health === 'error') {
        return isset($st['message']) ? $st['message'] : '报错';
    }
    $s = strtolower((string) (isset($st['state']) ? $st['state'] : ''));
    if (in_array($s, ['standby', 'idle', 'ready'], true)) {
        return '机器空闲';
    }
    if (in_array($s, ['finish', 'finished', 'complete'], true)) {
        return '打印完成';
    }
    if (!empty($st['filename'])) {
        return $st['filename'];
    }
    return isset($st['state']) ? $st['state'] : '--';
}

function layout_start($title, $active = 'home')
{
    $nav = [
        'home' => ['index.php', '首页'],
        'filament' => ['filament.php', '耗材'],
        'monitor' => ['monitor.php', '监控'],
    ];
    echo '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">';
    echo '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
    echo '<title>' . h($title) . ' · hanye-3D打印机监控台</title>';
    echo '<link rel="stylesheet" href="assets/style.css"></head><body>';
    echo '<div class="app"><header class="top"><div class="brand">hanye-3D打印机监控台</div><nav class="nav">';
    foreach ($nav as $k => $item) {
        $cls = $k === $active ? ' class="active"' : '';
        echo '<a' . $cls . ' href="' . h($item[0]) . '">' . h($item[1]) . '</a>';
    }
    echo '</nav></header><main class="main">';
}

function layout_end()
{
    echo '</main></div></body></html>';
}
