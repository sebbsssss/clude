import 'dart:io' show Platform;

class Env {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://clude.io',
  );
  static const String devBaseUrl = 'https://cludebot-test-preview.up.railway.app';

  static String get apiBaseUrl =>
      const bool.fromEnvironment('dart.vm.product') ? baseUrl : devBaseUrl;

  static const String solanaCluster = String.fromEnvironment(
    'SOLANA_CLUSTER',
    defaultValue: 'mainnet-beta',
  );

  static const String privyAppId = String.fromEnvironment(
    'PRIVY_APP_ID',
    defaultValue: 'cmm8y16dq037y0cjr4nsqjtaa',
  );

  // Privy requires a separate client per platform (the iOS client rejects
  // Android's package name and vice versa). Build-time override wins;
  // otherwise pick by platform.
  static const String _privyClientIdOverride =
      String.fromEnvironment('PRIVY_CLIENT_ID');
  static const String _iosPrivyClientId =
      'client-WY6Wj8WFZ9B3kWRDb4Cw8BsCj9WkcgDmYt9jY5PzoVsEH';
  static const String _androidPrivyClientId =
      'client-WY6Wj8WFZ9B3kWRDb4Cw8BsCj9WkcgDmYt8Pj8PmTsCJF';

  static String get privyClientId {
    if (_privyClientIdOverride.isNotEmpty) return _privyClientIdOverride;
    return Platform.isAndroid ? _androidPrivyClientId : _iosPrivyClientId;
  }
}
