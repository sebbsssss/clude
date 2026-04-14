import 'dart:async';
import 'dart:convert';
import 'package:pinenacl/x25519.dart';
import 'package:privy_flutter/privy_flutter.dart';
import 'package:uni_links/uni_links.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../config/env.dart';
import '../api/api_client.dart';

/// Base58 alphabet used by Solana / Phantom.
const _base58Alphabet =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/// Handles Phantom wallet deep-link connect + sign, then authenticates via
/// Privy SIWS and exchanges the Privy JWT for a Cortex API key.
///
/// Flow:
/// 1. Connect to Phantom (get wallet public key + session)
/// 2. Generate SIWS message via Privy SDK
/// 3. Sign SIWS message via Phantom
/// 4. Authenticate with Privy SIWS (get Privy user)
/// 5. Get Privy JWT via user.getAccessToken()
/// 6. POST /api/chat/auto-register with JWT (same as web)
class WalletAuthService {
  final Privy _privy;
  final ApiClient _apiClient;

  StreamSubscription<Uri?>? _linkSub;
  PrivateKey? _dappPrivateKey;
  PublicKey? _phantomPublicKey;
  Uint8List? _session;

  WalletAuthService(this._privy, this._apiClient);

  /// Runs the full connect → sign → Privy SIWS → auto-register flow.
  /// Returns API key and wallet address on success.
  Future<({String apiKey, String wallet})> connectAndSign() async {
    // 1. Generate ephemeral X25519 keypair
    _dappPrivateKey = PrivateKey.generate();
    final dappPublicKeyBase58 =
        _base58Encode(_dappPrivateKey!.publicKey.asTypedList);

    // 2. Connect to Phantom
    final connectUri = Uri.parse('https://phantom.app/ul/v1/connect').replace(
      queryParameters: {
        'dapp_encryption_public_key': dappPublicKeyBase58,
        'redirect_link': 'clude://wallet-connect',
        'cluster': Env.solanaCluster,
        'app_url': 'https://clude.io',
      },
    );

    // 3. Start listening BEFORE launching Phantom to avoid race condition
    final connectFuture = _waitForDeepLink('wallet-connect');

    if (!await launchUrl(connectUri, mode: LaunchMode.externalApplication)) {
      _linkSub?.cancel();
      throw Exception('Could not open Phantom. Is it installed?');
    }

    final connectCallback = await connectFuture;

    // Check for errors
    final errorCode = connectCallback.queryParameters['errorCode'];
    if (errorCode != null) {
      final errorMessage =
          connectCallback.queryParameters['errorMessage'] ??
              'Connection rejected';
      throw Exception(errorMessage);
    }

    // Extract phantom public key and encrypted data
    final phantomPubKeyBase58 =
        connectCallback.queryParameters['phantom_encryption_public_key'];
    final dataBase58 = connectCallback.queryParameters['data'];
    final nonceBase58 = connectCallback.queryParameters['nonce'];

    if (phantomPubKeyBase58 == null ||
        dataBase58 == null ||
        nonceBase58 == null) {
      throw Exception('Incomplete connect response from Phantom.');
    }

    _phantomPublicKey = PublicKey(_base58Decode(phantomPubKeyBase58));

    // Decrypt connect response
    final connectData = _decrypt(
      _base58Decode(dataBase58),
      _base58Decode(nonceBase58),
    );
    final connectJson =
        jsonDecode(utf8.decode(connectData)) as Map<String, dynamic>;
    final walletPublicKey = connectJson['public_key'] as String;
    _session = _base58Decode(connectJson['session'] as String);

    // 4. Ensure Privy SDK is ready before SIWS calls
    await _privy.getAuthState();

    // 5. Generate SIWS message via Privy
    final siwsParams = SiwsMessageParams(
      appDomain: 'clude.io',
      appUri: 'https://clude.io',
      walletAddress: walletPublicKey,
    );

    final messageResult = await _privy.siws.generateMessage(siwsParams);
    final siwsMessage = switch (messageResult) {
      Success(value: final msg) => msg,
      Failure(error: final err) =>
        throw Exception('Failed to generate SIWS message: ${err.message}'),
    };

    // 5. Sign SIWS message via Phantom
    final messageBytes = Uint8List.fromList(utf8.encode(siwsMessage));
    final signPayload = jsonEncode({
      'message': _base58Encode(messageBytes),
      'session': _base58Encode(_session!),
      'display': 'utf8',
    });
    final signNonce = _generateNonce();
    final encryptedSignPayload = _encrypt(
      Uint8List.fromList(utf8.encode(signPayload)),
      signNonce,
    );

    final signUri = Uri.parse('https://phantom.app/ul/v1/signMessage').replace(
      queryParameters: {
        'dapp_encryption_public_key': dappPublicKeyBase58,
        'redirect_link': 'clude://wallet-sign',
        'nonce': _base58Encode(signNonce),
        'payload': _base58Encode(encryptedSignPayload),
      },
    );

    final signFuture = _waitForDeepLink('wallet-sign');

    if (!await launchUrl(signUri, mode: LaunchMode.externalApplication)) {
      _linkSub?.cancel();
      throw Exception('Could not open Phantom for signing.');
    }

    final signCallback = await signFuture;

    final signErrorCode = signCallback.queryParameters['errorCode'];
    if (signErrorCode != null) {
      final signErrorMessage =
          signCallback.queryParameters['errorMessage'] ?? 'Signing rejected';
      throw Exception(signErrorMessage);
    }

    final signDataBase58 = signCallback.queryParameters['data'];
    final signNonceBase58 = signCallback.queryParameters['nonce'];

    if (signDataBase58 == null || signNonceBase58 == null) {
      throw Exception('Incomplete sign response from Phantom.');
    }

    final signData = _decrypt(
      _base58Decode(signDataBase58),
      _base58Decode(signNonceBase58),
    );
    final signJson =
        jsonDecode(utf8.decode(signData)) as Map<String, dynamic>;
    final signatureBase58 = signJson['signature'] as String;

    // Convert signature from base58 (Phantom format) to base64 (Privy format)
    final signatureBytes = _base58Decode(signatureBase58);
    final signatureBase64 = base64Encode(signatureBytes);

    // 6. Authenticate with Privy SIWS
    final metadata = WalletLoginMetadata(
      walletClientType: WalletClientType.other,
      connectorType: 'phantom_deeplink',
    );

    final loginResult = await _privy.siws.login(
      message: siwsMessage,
      signature: signatureBase64,
      params: siwsParams,
      metadata: metadata,
    );

    final privyUser = switch (loginResult) {
      Success(value: final user) => user,
      Failure(error: final err) =>
        throw Exception('Privy SIWS login failed: ${err.message}'),
    };

    // 7. Get Privy JWT
    final tokenResult = await privyUser.getAccessToken();
    final jwt = switch (tokenResult) {
      Success(value: final token) => token,
      Failure(error: final err) =>
        throw Exception('Failed to get Privy access token: ${err.message}'),
    };

    // 8. Exchange JWT for Cortex API key (same endpoint as web)
    final registered = await _apiClient.autoRegister(jwt, walletPublicKey);
    return (apiKey: registered.apiKey, wallet: walletPublicKey);
  }

  /// Wait for a deep link with the given host.
  Future<Uri> _waitForDeepLink(
    String host, {
    Duration timeout = const Duration(minutes: 5),
  }) {
    final completer = Completer<Uri>();

    _linkSub = uriLinkStream.listen(
      (uri) {
        if (uri != null && uri.scheme == 'clude' && uri.host == host) {
          _linkSub?.cancel();
          completer.complete(uri);
        }
      },
      onError: (Object err) {
        _linkSub?.cancel();
        completer.completeError(err);
      },
    );

    return completer.future.timeout(timeout, onTimeout: () {
      _linkSub?.cancel();
      throw TimeoutException('Wallet connect timed out.', timeout);
    });
  }

  /// NaCl box encrypt using dapp private key + phantom public key.
  Uint8List _encrypt(Uint8List data, Uint8List nonce) {
    final box =
        Box(myPrivateKey: _dappPrivateKey!, theirPublicKey: _phantomPublicKey!);
    final encrypted = box.encrypt(data, nonce: nonce);
    return Uint8List.fromList(encrypted.cipherText);
  }

  /// NaCl box decrypt using dapp private key + phantom public key.
  Uint8List _decrypt(Uint8List ciphertext, Uint8List nonce) {
    final box =
        Box(myPrivateKey: _dappPrivateKey!, theirPublicKey: _phantomPublicKey!);
    return Uint8List.fromList(
      box.decrypt(ByteList(ciphertext), nonce: Uint8List.fromList(nonce)),
    );
  }

  /// Generate a random 24-byte nonce.
  Uint8List _generateNonce() {
    return PineNaClUtils.randombytes(24);
  }

  /// Cancel a pending flow.
  void cancel() {
    _linkSub?.cancel();
    _linkSub = null;
  }
}

/// Base58 encode bytes.
String _base58Encode(Uint8List bytes) {
  if (bytes.isEmpty) return '';
  var value = BigInt.zero;
  for (final byte in bytes) {
    value = (value << 8) | BigInt.from(byte);
  }
  final sb = StringBuffer();
  while (value > BigInt.zero) {
    final remainder = (value % BigInt.from(58)).toInt();
    value = value ~/ BigInt.from(58);
    sb.write(_base58Alphabet[remainder]);
  }
  for (final byte in bytes) {
    if (byte == 0) {
      sb.write('1');
    } else {
      break;
    }
  }
  return sb.toString().split('').reversed.join();
}

/// Base58 decode string to bytes.
Uint8List _base58Decode(String str) {
  var value = BigInt.zero;
  for (final char in str.split('')) {
    final index = _base58Alphabet.indexOf(char);
    if (index == -1) throw FormatException('Invalid base58 character: $char');
    value = value * BigInt.from(58) + BigInt.from(index);
  }
  final bytes = <int>[];
  while (value > BigInt.zero) {
    bytes.insert(0, (value & BigInt.from(0xff)).toInt());
    value = value >> 8;
  }
  for (final char in str.split('')) {
    if (char == '1') {
      bytes.insert(0, 0);
    } else {
      break;
    }
  }
  return Uint8List.fromList(bytes);
}
