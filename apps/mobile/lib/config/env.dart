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
}
