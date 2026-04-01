import 'package:flutter/material.dart';

class MemoryPanelScreen extends StatelessWidget {
  const MemoryPanelScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Memory')),
      body: const Center(child: Text('Memory Panel')),
    );
  }
}
