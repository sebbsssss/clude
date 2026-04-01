import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

enum ConnectivityStatus { online, offline }

ConnectivityStatus mapConnectivity(List<ConnectivityResult> results) {
  return results.any((r) => r != ConnectivityResult.none)
      ? ConnectivityStatus.online
      : ConnectivityStatus.offline;
}

final connectivityStreamProvider = StreamProvider<ConnectivityStatus>((ref) {
  return Connectivity().onConnectivityChanged.map(mapConnectivity);
});
