import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:privy_flutter/privy_flutter.dart';

import '../../config/env.dart';

final privyProvider = Provider<Privy>((ref) {
  return Privy.init(
    config: PrivyConfig(
      appId: Env.privyAppId,
      appClientId: Env.privyClientId,
      logLevel: PrivyLogLevel.none,
    ),
  );
});
