const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Helm Chart Validation', () => {
  const chartPath = path.join(__dirname, '../../k8s/charts/leaseflow-backend');

  beforeAll(() => {
    // Ensure chart directory exists
    if (!fs.existsSync(chartPath)) {
      throw new Error(`Helm chart directory not found: ${chartPath}`);
    }
  });

  describe('Chart Structure', () => {
    it('should have required chart files', () => {
      const requiredFiles = [
        'Chart.yaml',
        'values.yaml',
        'templates/_helpers.tpl',
        'templates/deployment.yaml',
        'templates/service.yaml',
        'templates/ingress.yaml',
        'templates/configmap.yaml',
        'templates/secrets.yaml',
        'templates/pdb.yaml',
        'templates/hpa.yaml',
        'templates/servicemonitor.yaml',
      ];

      requiredFiles.forEach(file => {
        const filePath = path.join(chartPath, file);
        expect(fs.existsSync(filePath)).toBe(true);
      });
    });

    it('should have valid Chart.yaml', () => {
      const chartYamlPath = path.join(chartPath, 'Chart.yaml');
      const chartContent = fs.readFileSync(chartYamlPath, 'utf8');
      
      expect(chartContent).toContain('apiVersion: v2');
      expect(chartContent).toContain('name: leaseflow-backend');
      expect(chartContent).toContain('type: application');
      expect(chartContent).toContain('version: 0.1.0');
      expect(chartContent).toContain('appVersion: "1.0.0"');
    });

    it('should have comprehensive values.yaml', () => {
      const valuesYamlPath = path.join(chartPath, 'values.yaml');
      const valuesContent = fs.readFileSync(valuesYamlPath, 'utf8');
      
      // Check key sections
      expect(valuesContent).toContain('replicaCount:');
      expect(valuesContent).toContain('image:');
      expect(valuesContent).toContain('service:');
      expect(valuesContent).toContain('ingress:');
      expect(valuesContent).toContain('resources:');
      expect(valuesContent).toContain('autoscaling:');
      expect(valuesContent).toContain('podDisruptionBudget:');
      expect(valuesContent).toContain('strategy:');
      expect(valuesContent).toContain('configMap:');
      expect(valuesContent).toContain('secrets:');
      expect(valuesContent).toContain('monitoring:');
      
      // Check zero-downtime configurations
      expect(valuesContent).toContain('maxSurge: 25%');
      expect(valuesContent).toContain('maxUnavailable: 0');
      expect(valuesContent).toContain('minAvailable: 2');
      
      // Check TLS configuration
      expect(valuesContent).toContain('cert-manager.io/cluster-issuer: "letsencrypt-prod"');
    });
  });

  describe('Template Validation', () => {
    it('should render deployment template successfully', () => {
      try {
        const output = execSync(`helm template ${chartPath} --show-only templates/deployment.yaml`, {
          encoding: 'utf8',
          stdio: 'pipe'
        });
        
        // Check for key deployment features
        expect(output).toContain('kind: Deployment');
        expect(output).toContain('maxSurge: 25%');
        expect(output).toContain('maxUnavailable: 0');
        expect(output).toContain('terminationGracePeriodSeconds: 60');
        expect(output).toContain('wait-for-db');
        expect(output).toContain('wait-for-redis');
      } catch (error) {
        throw error;
      }
    });

    it('should render service template successfully', () => {
      try {
        const output = execSync(`helm template ${chartPath} --show-only templates/service.yaml`, {
          encoding: 'utf8',
          stdio: 'pipe'
        });
        
        expect(output).toContain('kind: Service');
        expect(output).toContain('port: 4000');
        expect(output).toContain('name: http');
        expect(output).toContain('name: metrics');
      } catch (error) {
        throw error;
      }
    });

    it('should render ingress template with TLS', () => {
      try {
        const output = execSync(`helm template ${chartPath} --show-only templates/ingress.yaml`, {
          encoding: 'utf8',
          stdio: 'pipe'
        });
        
        expect(output).toContain('kind: Ingress');
        expect(output).toContain('cert-manager.io/cluster-issuer');
        expect(output).toContain('nginx.ingress.kubernetes.io/ssl-redirect');
        expect(output).toContain('secretName: leaseflow-backend-tls');
      } catch (error) {
        throw error;
      }
    });

    it('should render PodDisruptionBudget template', () => {
      try {
        const output = execSync(`helm template ${chartPath} --show-only templates/pdb.yaml`, {
          encoding: 'utf8',
          stdio: 'pipe'
        });
        
        expect(output).toContain('kind: PodDisruptionBudget');
        expect(output).toContain('minAvailable: 2');
      } catch (error) {
        throw error;
      }
    });

    it('should render HPA template', () => {
      try {
        const output = execSync(`helm template ${chartPath} --show-only templates/hpa.yaml`, {
          encoding: 'utf8',
          stdio: 'pipe'
        });
        
        expect(output).toContain('kind: HorizontalPodAutoscaler');
        expect(output).toContain('minReplicas: 3');
        expect(output).toContain('maxReplicas: 10');
        expect(output).toContain('targetCPUUtilizationPercentage: 70');
      } catch (error) {
        throw error;
      }
    });

    it('should render ServiceMonitor template', () => {
      try {
        const output = execSync(`helm template ${chartPath} --show-only templates/servicemonitor.yaml`, {
          encoding: 'utf8',
          stdio: 'pipe'
        });
        
        expect(output).toContain('kind: ServiceMonitor');
        expect(output).toContain('port: metrics');
        expect(output).toContain('path: /metrics');
      } catch (error) {
        throw error;
      }
    });
  });

  describe('Helm Lint and Validation', () => {
    it('should pass helm lint', () => {
      try {
        execSync(`helm lint ${chartPath}`, {
          stdio: 'pipe'
        });
      } catch (error) {
        throw error;
      }
    });

    it('should render all templates without errors', () => {
      try {
        execSync(`helm template ${chartPath}`, {
          stdio: 'pipe'
        });
      } catch (error) {
        throw error;
      }
    });

    it('should validate with dry-run', () => {
      try {
        execSync(`helm template ${chartPath} --validate`, {
          stdio: 'pipe'
        });
      } catch (error) {
        throw error;
      }
    });
  });

  describe('Security and Best Practices', () => {
    it('should have security context configured', () => {
      try {
        const output = execSync(`helm template ${chartPath} --show-only templates/deployment.yaml`, {
          encoding: 'utf8',
          stdio: 'pipe'
        });
        
        // Check for security context configurations
        expect(output).toContain('runAsNonRoot: true');
        expect(output).toContain('runAsUser: 1000');
        expect(output).toContain('fsGroup: 1000');
        expect(output).toContain('allowPrivilegeEscalation: false');
        expect(output).toContain('capabilities:');
        expect(output).toContain('drop:');
        expect(output).toContain('ALL');
        expect(output).toContain('readOnlyRootFilesystem: true');
      } catch (error) {
        throw error;
      }
    });

    it('should have resource limits configured', () => {
      try {
        const output = execSync(`helm template ${chartPath} --show-only templates/deployment.yaml`, {
          encoding: 'utf8',
          stdio: 'pipe'
        });
        
        expect(output).toContain('resources:');
        expect(output).toContain('limits:');
        expect(output).toContain('requests:');
        expect(output).toContain('cpu:');
        expect(output).toContain('memory:');
      } catch (error) {
        throw error;
      }
    });

    it('should have health checks configured', () => {
      try {
        const output = execSync(`helm template ${chartPath} --show-only templates/deployment.yaml`, {
          encoding: 'utf8',
          stdio: 'pipe'
        });
        
        expect(output).toContain('livenessProbe:');
        expect(output).toContain('readinessProbe:');
        expect(output).toContain('startupProbe:');
        expect(output).toContain('path: /health');
        expect(output).toContain('path: /ready');
      } catch (error) {
        throw error;
      }
    });
  });

  describe('Federation and RWA Support', () => {
    it('should include federation configuration in values', () => {
      const valuesYamlPath = path.join(chartPath, 'values.yaml');
      const valuesContent = fs.readFileSync(valuesYamlPath, 'utf8');
      
      expect(valuesContent).toContain('FEDERATION_ENABLED: "true"');
      expect(valuesContent).toContain('IPFS_NODE_URL:');
    });

    it('should support gateway configuration', () => {
      const valuesYamlPath = path.join(chartPath, 'values.yaml');
      const valuesContent = fs.readFileSync(valuesYamlPath, 'utf8');
      
      expect(valuesContent).toContain('gateway:');
      expect(valuesContent).toContain('enabled: false');
      expect(valuesContent).toContain('host: gateway.leaseflow.protocol');
    });
  });
});
