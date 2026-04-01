import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/connectivity/connectivity_provider.dart';

class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connectivity = ref.watch(connectivityStreamProvider);

    final isOffline = connectivity.when(
      data: (status) => status == ConnectivityStatus.offline,
      loading: () => false,
      error: (_, __) => false,
    );

    return AnimatedSize(
      duration: const Duration(milliseconds: 200),
      child: isOffline
          ? Container(
              width: double.infinity,
              color: Colors.amber.shade800,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: const Row(
                children: [
                  Icon(Icons.wifi_off, size: 18, color: Colors.white),
                  SizedBox(width: 8),
                  Text(
                    'No internet connection',
                    style: TextStyle(color: Colors.white, fontSize: 14),
                  ),
                ],
              ),
            )
          : const SizedBox.shrink(),
    );
  }
}
