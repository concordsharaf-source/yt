<?php
header('Content-Type: text/plain; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo 'POST only';
  exit;
}
$in = json_decode(file_get_contents('php://input'), true);
if (!$in || empty($in['endpoint']) || empty($in['body'])) {
  http_response_code(400);
  echo 'bad payload';
  exit;
}
$endpoint = $in['endpoint'];
if (!preg_match('#^https://#', $endpoint)) {
  http_response_code(400);
  echo 'bad endpoint';
  exit;
}
$body = $in['body'];
$body = strtr($body, '-_', '+/');
$pad = strlen($body) % 4;
if ($pad) $body .= str_repeat('=', 4 - $pad);
$raw = base64_decode($body, true);
if ($raw === false) {
  http_response_code(400);
  echo 'bad body';
  exit;
}
$headers = isset($in['headers']) && is_array($in['headers']) ? $in['headers'] : array();
$ch = curl_init($endpoint);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $raw);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HEADER, true);
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
http_response_code($code ? $code : 502);
echo $resp;
