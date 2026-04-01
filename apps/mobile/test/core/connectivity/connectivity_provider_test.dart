import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:clude_mobile/core/connectivity/connectivity_provider.dart';

void main() {
  group('connectivityProvider', () {
    late StreamController<List<ConnectivityResult>> controller;

    setUp(() {
      controller = StreamController<List<ConnectivityResult>>();
    });

    tearDown(() {
      controller.close();
    });

    ProviderContainer createContainer() {
      return ProviderContainer(
        overrides: [
          connectivityStreamProvider
              .overrideWith((ref) => controller.stream.map(mapConnectivity)),
        ],
      );
    }

    test('emits online when wifi is available', () async {
      final container = createContainer();
      addTearDown(container.dispose);

      container.listen(connectivityStreamProvider, (_, __) {});

      controller.add([ConnectivityResult.wifi]);
      await Future<void>.delayed(Duration.zero);

      final state = container.read(connectivityStreamProvider);
      expect(state.value, ConnectivityStatus.online);
    });

    test('emits offline when no connectivity', () async {
      final container = createContainer();
      addTearDown(container.dispose);

      container.listen(connectivityStreamProvider, (_, __) {});

      controller.add([ConnectivityResult.none]);
      await Future<void>.delayed(Duration.zero);

      final state = container.read(connectivityStreamProvider);
      expect(state.value, ConnectivityStatus.offline);
    });

    test('emits online when any result is not none', () async {
      final container = createContainer();
      addTearDown(container.dispose);

      container.listen(connectivityStreamProvider, (_, __) {});

      controller.add([ConnectivityResult.none, ConnectivityResult.mobile]);
      await Future<void>.delayed(Duration.zero);

      final state = container.read(connectivityStreamProvider);
      expect(state.value, ConnectivityStatus.online);
    });
  });

  group('mapConnectivity', () {
    test('returns online for wifi', () {
      expect(
        mapConnectivity([ConnectivityResult.wifi]),
        ConnectivityStatus.online,
      );
    });

    test('returns offline for none', () {
      expect(
        mapConnectivity([ConnectivityResult.none]),
        ConnectivityStatus.offline,
      );
    });

    test('returns online for mixed results including non-none', () {
      expect(
        mapConnectivity([ConnectivityResult.none, ConnectivityResult.ethernet]),
        ConnectivityStatus.online,
      );
    });
  });
}
