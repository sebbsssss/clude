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

  static const String privyClientId = String.fromEnvironment(
    'PRIVY_CLIENT_ID',
    defaultValue: 'client-WY6Wj8WFZ9B3kWRDb4Cw8BsCj9WkcgDmYt9jY5PzoVsEH',
  );
}
